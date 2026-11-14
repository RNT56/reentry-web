import { brandMark } from "../../shared/brand.js";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { esc } from "../../shared/format.js";
import { request } from "../../shared/http.js";
const mark = brandMark();
export function showAuth(onAuthenticated, registration = true, mode = "login") {
  const app = document.querySelector("#app");
  app.innerHTML = `<main class="auth-shell"><div class="auth-brand">${mark}reentry</div><section class="auth-card"><h1>${mode === "register" ? "Create account." : mode === "recover" ? "Recover account." : "Welcome back."}</h1>${mode === "login" ? `<button class="secondary passkey-login" id="passkey-login" ${!browserSupportsWebAuthn() ? "disabled" : ""}>◉ Continue with passkey</button><div class="auth-or">or use your password</div>` : ""}<form id="auth-form"><div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_]{3,32}" minlength="3" maxlength="32" placeholder="Your username" required></div>${mode === "recover" ? '<div class="field"><label for="recovery-key">Recovery key</label><input id="recovery-key" name="recoveryKey" autocomplete="off" required></div>' : ""}<div class="field"><label for="password">${mode === "recover" ? "New password" : "Password"}</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="${mode === "login" ? 1 : 12}" maxlength="128" placeholder="${mode === "login" ? "Your password" : "At least 12 characters"}" required><button type="button" id="show-password" aria-label="Show password">Show</button></div></div><p class="error" id="auth-error" role="alert"></p><button class="primary auth-submit" type="submit">${mode === "register" ? "Create account" : mode === "recover" ? "Recover account" : "Sign in"} <span>↗</span></button></form><div class="auth-links">${mode === "login" ? `${registration ? '<button class="link" id="to-register">Create an account</button>' : ""}<button class="link" id="to-recover">Lost access?</button>` : '<button class="link" id="to-login">Back to sign in</button>'}</div></section><p class="auth-footer"><a href="/journal">Read RNT’s journal ↗</a></p></main>`;
  const $ = (s) => document.querySelector(s);
  $("#show-password").onclick = () => {
    const visible = $("#password").type === "password";
    $("#password").type = visible ? "text" : "password";
    $("#show-password").textContent = visible ? "Hide" : "Show";
    $("#show-password").setAttribute(
      "aria-label",
      visible ? "Hide password" : "Show password",
    );
  };
  for (const m of ["login", "register", "recover"])
    if ($("#to-" + m))
      $("#to-" + m).onclick = () => showAuth(onAuthenticated, registration, m);
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("[type=submit]");
    button.disabled = true;
    $("#auth-error").textContent = "";
    try {
      const data = await request(
        "/api/auth/" + mode,
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      if (data.recoveryKey)
        showRecovery(data.recoveryKey, () => onAuthenticated(data.user, true));
      else await onAuthenticated(data.user, false);
    } catch (err) {
      $("#auth-error").textContent = err.message;
      button.disabled = false;
    }
  };
  if ($("#passkey-login"))
    $("#passkey-login").onclick = async () => {
      const b = $("#passkey-login");
      b.disabled = true;
      $("#auth-error").textContent = "";
      try {
        const optionsJSON = await request(
            "/api/auth/passkeys/login-options",
            "POST",
            {},
          ),
          credential = await startAuthentication({ optionsJSON }),
          data = await request("/api/auth/passkeys/login", "POST", {
            credential,
          });
        await onAuthenticated(data.user, false);
      } catch (e) {
        $("#auth-error").textContent = passkeyMessage(e);
        b.disabled = false;
      }
    };
}
function passkeyMessage(e) {
  return e.name === "NotAllowedError"
    ? "Passkey cancelled. Try again or use your password."
    : e.message || "Passkey unavailable on this device.";
}
function showRecovery(key, done) {
  document.querySelector("#app").innerHTML =
    `<main class="auth-shell"><div class="auth-brand">${mark}reentry</div><section class="auth-card recovery-card"><span class="eyebrow">KEEP THIS SAFE</span><h1>Your way back in.</h1><p class="sub">Recovery key · shown once</p><code class="recovery-key">${esc(key)}</code><button class="secondary" id="download-key">↓ Download recovery key</button><label class="check-row"><input type="checkbox" id="key-saved"> I’ve saved my recovery key</label><button class="primary auth-submit" id="continue-key" disabled>Continue ↗</button></section></main>`;
  document.querySelector("#download-key").onclick = () =>
    download(
      "reentry-recovery-key.txt",
      `Reentry recovery key\n\n${key}\n\nKeep this private. It can reset your password and revoke passkeys.\n`,
    );
  document.querySelector("#key-saved").onchange = (e) =>
    (document.querySelector("#continue-key").disabled = !e.target.checked);
  document.querySelector("#continue-key").onclick = done;
}
export function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function accountCard(user) {
  return `<section class="panel settings-card account-card"><div class="account-heading"><span class="account-avatar">${esc(user.username[0].toUpperCase())}</span><div><h2>${esc(user.username)}</h2></div></div><div class="account-actions"><button class="secondary" id="passkeys">◉ Passkeys <span>↗</span></button><button class="secondary" id="change-password">Change password <span>↗</span></button><button class="secondary" id="sign-out">Sign out <span>↗</span></button><button class="link" id="sign-out-all">Sign out all devices</button></div></section>`;
}
export function bindAccount({ modal, close, toast, onLogout }) {
  document.querySelector("#sign-out").onclick = () => onLogout(false);
  document.querySelector("#sign-out-all").onclick = () => onLogout(true);
  document.querySelector("#change-password").onclick = () => {
    modal(
      `<h2>Change password</h2><form id="password-form"><div class="field"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></div><div class="field"><label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><p class="small">Other sessions will be signed out.</p><p class="error" id="pw-error" role="alert"></p><div class="actions"><button class="primary">Save password</button></div></form>`,
    );
    document.querySelector("#password-form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        await request(
          "/api/auth/password",
          "POST",
          Object.fromEntries(new FormData(e.target)),
        );
        close();
        toast("Password updated. Other sessions signed out.");
      } catch (err) {
        document.querySelector("#pw-error").textContent = err.message;
        b.disabled = false;
      }
    };
  };
  document.querySelector("#passkeys").onclick = () =>
    openPasskeys({ modal, close, toast });
}
export async function openPasskeys({ modal, close, toast }) {
  let data;
  try {
    data = await request("/api/auth/passkeys");
  } catch (e) {
    toast(e.message);
    return;
  }
  modal(
    `<h2>Your passkeys</h2><div class="passkey-list">${data.passkeys.map((k) => `<div class="row lot-row"><div><b>${esc(k.name)}</b><span class="small">Added ${new Date(k.created_at).toLocaleDateString()}</span></div><button class="link" data-key-remove="${esc(k.id)}">Remove</button></div>`).join("") || '<p class="note">No passkeys</p>'}</div><div class="field"><label>Passkey name</label><input id="passkey-name" maxlength="60" value="My device"></div><div id="passkey-error" class="error" role="alert"></div><div class="actions"><button class="primary" id="add-passkey" ${!browserSupportsWebAuthn() ? "disabled" : ""}>Add passkey ↗</button></div>`,
  );
  const reverify = (retry) => {
    close();
    modal(
      `<h2>Verify it’s you</h2><form id="reauth"><label>Password</label><input name="password" type="password" autocomplete="current-password" required><p id="reauth-error" class="error"></p><div class="actions"><button class="primary">Continue</button></div></form>`,
    );
    document.querySelector("#reauth").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await request(
          "/api/auth/verify-password",
          "POST",
          Object.fromEntries(new FormData(e.target)),
        );
        close();
        await retry();
      } catch (err) {
        document.querySelector("#reauth-error").textContent = err.message;
      }
    };
  };
  document.querySelector("#add-passkey").onclick = async () => {
    const b = document.querySelector("#add-passkey"),
      name = document.querySelector("#passkey-name").value;
    b.disabled = true;
    try {
      const optionsJSON = await request(
          "/api/auth/passkeys/register-options",
          "POST",
          {},
        ),
        credential = await startRegistration({ optionsJSON });
      await request("/api/auth/passkeys/register", "POST", {
        credential,
        name,
      });
      close();
      toast("Passkey added.");
      await openPasskeys({ modal, close, toast });
    } catch (e) {
      if (e.status === 403) {
        reverify(() => openPasskeys({ modal, close, toast }));
        return;
      }
      document.querySelector("#passkey-error").textContent = passkeyMessage(e);
      b.disabled = false;
    }
  };
  document.querySelectorAll("[data-key-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.keyRemove;
        close();
        modal(
          `<h2>Remove this passkey?</h2><p class="sub">You can still sign in with your password or another passkey.</p><p class="error" id="remove-key-error"></p><div class="actions"><button class="secondary" id="keep-key">Keep</button><button class="danger" id="remove-key">Remove</button></div>`,
        );
        document.querySelector("#keep-key").onclick = () => {
          close();
          openPasskeys({ modal, close, toast });
        };
        document.querySelector("#remove-key").onclick = async () => {
          try {
            await request(
              "/api/auth/passkeys/" + encodeURIComponent(id),
              "DELETE",
            );
            close();
            openPasskeys({ modal, close, toast });
          } catch (e) {
            if (e.status === 403) {
              reverify(() => openPasskeys({ modal, close, toast }));
              return;
            }
            document.querySelector("#remove-key-error").textContent = e.message;
          }
        };
      }),
  );
}
