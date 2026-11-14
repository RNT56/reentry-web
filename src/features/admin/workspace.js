import { loadingSurface } from "../../shared/motion.js";
import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { action, usd, when } from "../intelligence/shared.js";
export function mountAdmin(
  root,
  { onStudio = () => {}, navigate = () => {} } = {},
) {
  let alive = true,
    timer;
  root.innerHTML = loadingSurface("owner");
  const bytes = (n) =>
    n > 1024 ** 3
      ? (n / 1024 ** 3).toFixed(1) + " GB"
      : Math.round(n / 1024 ** 2) + " MB";
  async function load() {
    try {
      const d = await request("/api/admin");
      if (!alive || !root.isConnected) return;
      render(d);
    } catch (e) {
      if (alive)
        root.innerHTML = `<div class="owner-error">${esc(e.message)}<button class="link" data-owner-retry>Retry ↗</button></div>`;
      root.querySelector("[data-owner-retry]")?.addEventListener("click", load);
    }
  }
  function render(d) {
    const total = Object.values(d.jobs).reduce((a, b) => a + b, 0);
    root.innerHTML = `<section class="owner-console"><header class="owner-heading"><div><span class="eyebrow">RNT / CONTROL ROOM</span></div><button class="link" data-owner-refresh>↻ ${esc(when(d.at))}</button></header><nav class="owner-shortcuts"><button data-owner-studio>Write ↗</button><a href="/journal" target="_blank" rel="noopener noreferrer">Journal ↗</a><button data-owner-settings>Models & keys ↗</button></nav><div class="owner-census">${Object.entries(
      d.counts,
    )
      .map(
        ([k, n]) =>
          `<div><strong>${n.toLocaleString()}</strong><span>${esc(k)}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="owner-split"><section class="owner-section"><div class="section-line"><h2>Controls</h2><span class="small">${total} runs</span></div><div class="owner-switches"><button role="switch" aria-checked="${!d.controls.aiPaused}" data-owner-ai><span>AI dispatch</span><b>${d.controls.aiPaused ? "Paused" : "Running"}</b><i></i></button><button role="switch" aria-checked="${d.controls.registrationOpen}" data-owner-registration><span>Registration</span><b>${d.controls.registrationOpen ? "Open" : "Closed"}</b><i></i></button></div><div class="owner-queue">${["queued", "running", "completed", "failed", "cancelled"].map((k) => `<div><span>${k}</span><strong>${d.jobs[k] || 0}</strong><i style="--fill:${total ? Math.max(1, ((d.jobs[k] || 0) / total) * 100) : 0}%"></i></div>`).join("")}</div><div class="section-line"><span class="small">${d.ledger.uncertain} unconfirmed</span><button class="link" data-owner-cancel ${!d.jobs.queued ? "disabled" : ""}>Clear queue ↗</button></div><div class="owner-cancel" hidden><strong>Cancel ${d.jobs.queued || 0} queued runs?</strong><button class="secondary" data-owner-keep>Keep</button><button class="primary" data-owner-confirm>Cancel queued runs</button></div></section><section class="owner-section"><div class="section-line"><h2>Runtime</h2><span class="small">${esc(d.runtime.node)}</span></div><dl class="owner-runtime"><div><dt>Uptime</dt><dd>${Math.floor(d.runtime.uptime / 3600)}h ${Math.floor((d.runtime.uptime % 3600) / 60)}m</dd></div><div><dt>Memory</dt><dd>${bytes(d.runtime.memory)}</dd></div>${d.runtime.disk ? `<div><dt>Disk free</dt><dd>${bytes(d.runtime.disk.free)}</dd></div>` : ""}<div><dt>Worker</dt><dd>${d.runtime.worker ? "Enabled" : "Offline"}</dd></div><div><dt>Key vault</dt><dd>${d.runtime.vault ? "Configured" : "Missing"}</dd></div><div><dt>Release</dt><dd>${esc(d.revision.slice(0, 8))}</dd></div><div><dt>API usage · all accounts</dt><dd>${usd(d.ledger.cost)}</dd></div><div><dt>Open reservations</dt><dd>${usd(d.ledger.held)}</dd></div></dl></section></div><section class="owner-section"><div class="section-line"><h2>Model rates</h2><span class="small">${esc(d.pricing.version)} · USD / M tokens</span></div><div class="owner-models">${d.pricing.models.map((m) => `<div><b>${esc(m.label)}</b><span>${m.valid ? "$" + m.input + " / $" + m.output : "Refresh required"}</span></div>`).join("")}</div></section>${
      d.activity.length
        ? `<section class="owner-section"><h2>Control history</h2><div class="owner-history">${d.activity
            .map(
              (a) =>
                `<div><time>${esc(when(a.at))}</time><b>${
                  a.action === "platform-queue-cancelled"
                    ? "Queue cleared"
                    : Object.entries(a.details)
                        .map(([k, v]) =>
                          k === "aiPaused"
                            ? "AI " + (v ? "paused" : "resumed")
                            : "Registration " + (v ? "opened" : "closed"),
                        )
                        .join(" · ")
                }</b></div>`,
            )
            .join("")}</div></section>`
        : ""
    }</section>`;
    root.querySelector("[data-owner-refresh]").onclick = load;
    root.querySelector("[data-owner-studio]").onclick = onStudio;
    root.querySelector("[data-owner-settings]").onclick = () =>
      navigate("settings");
    root.querySelector("[data-owner-ai]").onclick = (e) =>
      action(e.currentTarget, async () => {
        await request("/api/admin/settings", "PUT", {
          aiPaused: !d.controls.aiPaused,
        });
        await load();
      });
    root.querySelector("[data-owner-registration]").onclick = (e) =>
      action(e.currentTarget, async () => {
        await request("/api/admin/settings", "PUT", {
          registrationOpen: !d.controls.registrationOpen,
        });
        await load();
      });
    root.querySelector("[data-owner-cancel]").onclick = () => {
      root.querySelector(".owner-cancel").hidden = false;
    };
    root.querySelector("[data-owner-keep]").onclick = () => {
      root.querySelector(".owner-cancel").hidden = true;
    };
    root.querySelector("[data-owner-confirm]").onclick = (e) =>
      action(e.currentTarget, async () => {
        await request("/api/admin/queue/cancel", "POST", { confirmed: true });
        await load();
      });
  }
  load();
  timer = setInterval(() => {
    if (alive && !root.querySelector(".owner-cancel:not([hidden])")) load();
  }, 30000);
  return {
    destroy() {
      alive = false;
      clearInterval(timer);
    },
  };
}
