import { brandMark } from "./brand.js";
import { assetInfo, logoURL } from "../domain/assets.js";
import { $, esc } from "./format.js";
import { icon } from "./icons.js";
export { icon } from "./icons.js";
export function logo() {
  return brandMark();
}
export function monogram(h) {
  const a = assetInfo(h),
    url = logoURL(a);
  return `<span class="stock-icon asset-logo" style="--stock:#adc8ba"><span>${esc(h.symbol.replace(/[^A-Z]/g, "").slice(0, 2))}</span>${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>`;
}
export function bindLogos() {
  document.querySelectorAll(".asset-logo img").forEach((img) => {
    img.onerror = () => img.remove();
    if (img.complete && !img.naturalWidth) img.remove();
  });
}
export function associateLabels(root) {
  root.querySelectorAll("label").forEach((label, i) => {
    if (label.htmlFor || label.querySelector("input,select,textarea")) return;
    const input = label.nextElementSibling?.matches("input,select,textarea")
      ? label.nextElementSibling
      : label.nextElementSibling?.querySelector("input,select,textarea");
    if (input) {
      input.id ||= "field-" + i + "-" + root.id;
      label.htmlFor = input.id;
    }
  });
}
export function modal(html) {
  const dialog = $("#modal");
  dialog.innerHTML = `<button class="close icon-button" aria-label="Close dialog">${icon("close")}</button>${html}`;
  const header = document.createElement("header");
  header.className = "dialog-header";
  header.append(dialog.querySelector(".close"));
  const title = dialog.querySelector(":scope > h2");
  if (title) {
    if (title.previousElementSibling?.matches(".eyebrow"))
      header.append(title.previousElementSibling);
    const subtitle = title.nextElementSibling?.matches(".sub")
      ? title.nextElementSibling
      : null;
    title.id = "dialog-title";
    header.append(title);
    if (subtitle) header.append(subtitle);
    dialog.setAttribute("aria-labelledby", title.id);
  }
  const body = document.createElement("div");
  body.className = "dialog-body";
  body.append(...dialog.childNodes);
  for (const form of body.querySelectorAll("form")) {
    const submit = form.querySelector(
      ":scope > button.primary:not([type=button])",
    );
    if (submit && !form.querySelector(":scope > .actions")) {
      const actions = document.createElement("div");
      actions.className = "actions";
      submit.before(actions);
      actions.append(submit);
    }
  }
  dialog.append(header, body);
  associateLabels($("#modal"));
  bindLogos();
  $("#modal .close").onclick = close;
  $("#modal").showModal();
  document.documentElement.classList.add("dialog-open");
  dialog.addEventListener(
    "close",
    () => document.documentElement.classList.remove("dialog-open"),
    { once: true },
  );
  $("#modal").querySelector("input:not([type=hidden]),select")?.focus();
}
export function close() {
  $("#modal").close();
}
let toastTimer,
  toastVersion = 0;
export function toast(
  s,
  { actionLabel, onAction, duration = actionLabel ? 8000 : 4000 } = {},
) {
  const node = $("#toast"),
    version = ++toastVersion;
  clearTimeout(toastTimer);
  node.replaceChildren();
  const message = document.createElement("span");
  message.textContent = String(s);
  node.append(message);
  node.classList.toggle("has-action", !!(actionLabel && onAction));
  const expire = () => {
    if (version === toastVersion) {
      node.classList.remove("show");
      node.inert = true;
    }
  };
  const schedule = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(expire, duration);
  };
  if (actionLabel && onAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = actionLabel;
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      clearTimeout(toastTimer);
      try {
        await onAction();
        if (version === toastVersion) expire();
      } catch (error) {
        if (version === toastVersion)
          toast(error.message || "Could not complete this action.");
      }
    };
    node.append(button);
    node.onpointerenter = () => clearTimeout(toastTimer);
    node.onpointerleave = schedule;
    node.onfocusin = () => clearTimeout(toastTimer);
    node.onfocusout = schedule;
  } else
    node.onpointerenter =
      node.onpointerleave =
      node.onfocusin =
      node.onfocusout =
        null;
  node.inert = false;
  node.classList.add("show");
  schedule();
}
