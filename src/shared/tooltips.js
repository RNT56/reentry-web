// One tooltip surface for the workspace, dialogs and public journal.
export const featureHelp = Object.freeze({
  Portfolio:
    "Positions, purchase lots and current portfolio value. Recorded sales move into Buybacks.",
  Buybacks:
    "Track recorded sales and the price ceiling for buying back your target quantity after fees and estimated tax.",
  Research:
    "Asset evidence, private scenario trees and your journal. Select an asset to keep its research together.",
  Markets:
    "Market benchmarks and macroeconomic series. Each series retains its source and observation date.",
  Capitol:
    "Public transaction disclosures from the House, Senate and executive branch. Amounts are reported ranges, not exact trade values.",
  Studio:
    "Draft, format and preview articles. Publish creates a fixed edition; later draft edits stay private.",
  Journal:
    "Published articles with their asset links, sources and conditional scenario maps.",
  Strategies:
    "Group portfolio positions and connect them with the conditions behind your investment decisions.",
  Scenarios:
    "Conditional paths with a time horizon, price range and invalidation. A branch changes state when its condition is verified.",
  "Primary asset":
    "The scenario map belongs to this exact listing. Its stored research, notes and scenarios are included in AI requests.",
  "Related asset":
    "Link another exact listing and include its stored knowledge in AI context. Scenario ranges stay attached to the primary asset.",
  "Your prompt":
    "Editable instructions sent with the draft and selected assets' context. Changing a preset changes the request.",
  "Develop the idea.":
    "Use your connected AI model to draft or revise text. Review a proposal, then choose where to insert it.",
  "Voice & length":
    "Writing direction accompanies every request. Target words guide the model; they are not a hard length guarantee.",
  "Asset context":
    "The selected listings' stored sources, notes, analysis and scenarios. Review the exact records before generating.",
  "Full request":
    "The complete provider request, including your prompt, draft, asset evidence and response instructions.",
  Preview:
    "View the current draft with the published article layout. Unsaved changes are included.",
  "Save draft":
    "Save text, visuals, sources and scenario mapping privately. Published editions change only when you publish again.",
  Publish:
    "Create an immutable public edition of the current saved draft, including its visual data and images.",
  "Map with AI":
    "Propose scenario branches from the saved article. Review conditions, ranges and mapped passages before applying.",
  "Reduced motion":
    "Disable reading reveals and animated transitions. Your device's reduced-motion preference is also respected.",
  "Calculation defaults":
    "Defaults for new sale and buyback calculations. Recorded plans retain their saved assumptions.",
  "Tax rate":
    "The effective percentage applied to estimated taxable gains after the supplied losses and allowance.",
  "Effective rate (%)":
    "A single combined rate for this calculation, including any applicable surcharges you choose to include.",
  "Average cost":
    "Total remaining purchase cost, including purchase fees, divided by remaining shares.",
  "Total value":
    "Remaining shares multiplied by their displayed prices, expressed in EUR.",
  "Sale fee (€)":
    "Deducted from sale proceeds before the tax and reinvestment calculation.",
  "Buyback fee (€)":
    "Reserved from available cash before calculating how much you can pay per target share.",
  "Allowance (€)":
    "The unused allowance you choose to apply to this sale calculation.",
  "Loss offset (€)":
    "Losses you choose to offset against this sale’s estimated taxable gain.",
  "Fees & tax":
    "Adjust this calculation’s fees, unused allowance and loss offset. The effective tax rate comes from the holding or your defaults.",
  "Power struggle":
    "Distinct filers reporting purchases versus sales within the filing window. The balance compares people, not transaction dollars.",
  "Public pay. Private capital.":
    "Annual public-salary benchmarks alongside disclosed household purchases and sales. Trade amounts remain reported ranges.",
  "Cost basis":
    "Purchase cost plus purchase fees. Sales consume the oldest available lots first (FIFO).",
  "Taxable gain":
    "Sale gain less eligible losses and the allowance entered for this calculation, floored at zero.",
  "Tax estimate":
    "Estimated taxable gain multiplied by the selected effective tax rate.",
  "Available to reinvest":
    "Sale proceeds minus the sale fee and estimated tax. The buyback fee is deducted when calculating the target price.",
  "Buyback ceiling":
    "Available cash minus the buyback fee, divided by the target number of shares.",
  "Share increase":
    "Target shares divided by sold shares, minus one. A higher target quantity lowers the buyback price ceiling.",
  "Record sale":
    "Save this sale and its assumptions as a buyback plan. This does not place a brokerage order.",
  "Whole shares":
    "Round target quantities to whole shares when calculating the buyback ceiling.",
  "Monthly cap · US$":
    "Settled charges and outstanding holds share this monthly budget. Unconfirmed calls keep their holds until reconciled.",
  "Per-run cap · US$":
    "The maximum reserved cost for one request. A request is blocked before dispatch if its reservation exceeds this cap.",
  "Image cap · US$":
    "Image requests must fit both this cap and the general per-run cap. They also use the shared monthly budget.",
  "Image generation":
    "Uses your connected Gemini key and selected image model. Review the full prompt and maximum reservation in Studio before generating.",
  Usage:
    "Provider-reported usage and charges in USD. Held amounts cover in-flight or unconfirmed requests.",
  Connections:
    "Your encrypted provider API keys. Requests use your account with that provider.",
  "What changed":
    "Changes identified from new evidence for the watched scenario trees. Open a finding to inspect its supporting sources.",
  "Watch sources":
    "Check for new evidence on the selected schedule. AI analysis uses your existing spending caps.",
  "AI chart":
    "Analyze the selected chart history and propose annotated levels or scenarios. Review the output before keeping it.",
  "Median filing lag":
    "Median number of days between a reported transaction and its filing date in the current selection.",
  "Reported value":
    "The value range disclosed in the filing. It does not identify the exact amount invested or sold.",
  Disclosures:
    "Reported trades with transaction and filing dates. Filings may be amended or published after the trade date.",
  "Asset activity":
    "Disclosed buys and sells grouped by asset within your current filters.",
  "Source data":
    "The frozen values behind this figure. Calculations and chart transforms use this dataset.",
  "Evidence & credits":
    "Attach source links, an observation date and the basis of the visual. Image credits remain with the published edition.",
  Calculation:
    "A deterministic transform of the supplied data. Missing observations remain empty; values are not estimated.",
  "Alternative text":
    "Describe what the image communicates for readers using assistive technology.",
  Crop: "Choose the visible image frame. Fill crop trims the edges around the focal point; Fit image preserves the complete image.",
  "Scenario map":
    "Each branch ties a specific article passage to a condition, outlook and invalidation for the primary asset.",
  "Public source links":
    "References published with the article. Private research context is not added to this list automatically.",
});

export function tooltipPlacement(anchor, size, viewport) {
  const gap = 10,
    margin = 12,
    leftEdge = (viewport.left || 0) + margin,
    topEdge = (viewport.top || 0) + margin;
  const right = (viewport.left || 0) + viewport.width - margin,
    bottom = (viewport.top || 0) + viewport.height - margin;
  const above = anchor.top - gap - size.height >= topEdge;
  return {
    left: Math.max(
      leftEdge,
      Math.min(
        anchor.left + anchor.width / 2 - size.width / 2,
        right - size.width,
      ),
    ),
    top: Math.max(
      topEdge,
      Math.min(
        above ? anchor.top - gap - size.height : anchor.bottom + gap,
        bottom - size.height,
      ),
    ),
    side: above ? "above" : "below",
  };
}
let installed = false;
export function installTooltips() {
  if (installed) return;
  installed = true;
  const tip = document.createElement("div");
  tip.id = "reentry-tooltip";
  tip.className = "signal-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  tip.hidden = true;
  document.body.append(tip);
  let active = null,
    candidate = null,
    timer,
    visible = false,
    lastX = 0,
    lastY = 0,
    focusMode = false;
  const excluded = (el) =>
    el.closest(
      '.writing-prose,.journal-prose,.writing-proposal-text,[contenteditable="true"],.signal-tooltip',
    );
  const selector =
    "h1,h2,h3,label,summary,button,a,th,[title],.metric-label,.stat-label,.capitol-stats span,.settlement span,.position-context span,.summary-item > span,.stat > span,.target-choice > label";
  function annotate(root) {
    const nodes = [
      ...(root.matches?.(selector) ? [root] : []),
      ...(root.querySelectorAll?.(selector) || []),
    ];
    for (const el of nodes) {
      if (!(el instanceof HTMLElement) || excluded(el)) continue;
      const title = el.getAttribute("title");
      if (title) {
        el.dataset.tooltip = title;
        el.removeAttribute("title");
      }
      const directText = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(" ")
        .trim();
      const name = (el.dataset.help || directText || el.textContent || "")
        .trim()
        .replace(/\s+/g, " ");
      const help =
        featureHelp[name] || featureHelp[name.replace(/\s*[·↗].*$/, "")];
      if (!el.dataset.tooltip && help) el.dataset.tooltip = help;
      if (el.dataset.tooltip) {
        el.setAttribute("aria-description", el.dataset.tooltip);
        if (
          el.matches(
            "h1,h2,h3,label,.metric-label,.stat-label,.capitol-stats span,.settlement span",
          ) &&
          !el.hasAttribute("tabindex")
        )
          el.tabIndex = 0;
      }
    }
  }
  annotate(document.body);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") annotate(r.target);
      else {
        for (const n of r.addedNodes) if (n.nodeType === 1) annotate(n);
        if (r.target instanceof HTMLElement && r.target.matches(selector))
          annotate(r.target);
      }
    }
    if (active && !active.isConnected) hide();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  });
  function hide() {
    clearTimeout(timer);
    candidate = null;
    if (active) {
      const ids = (active.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== tip.id);
      if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
      else active.removeAttribute("aria-describedby");
    }
    if (visible && tip.hidePopover) {
      try {
        tip.hidePopover();
      } catch {
        /* detached dialog */
      }
    }
    tip.hidden = true;
    visible = false;
    active = null;
  }
  function show(el) {
    if (!el.isConnected || !el.dataset.tooltip || el.closest("[inert]")) return;
    hide();
    active = el;
    tip.textContent = el.dataset.tooltip;
    const host = tip.showPopover
      ? document.body
      : document.querySelector("dialog[open]") || document.body;
    if (tip.parentNode !== host) host.append(tip);
    tip.hidden = false;
    if (tip.showPopover) {
      try {
        tip.showPopover();
      } catch {
        /* fallback fixed surface */
      }
    }
    const viewport = window.visualViewport,
      bounds = {
        left: viewport?.offsetLeft || 0,
        top: viewport?.offsetTop || 0,
        width: viewport?.width || innerWidth,
        height: viewport?.height || innerHeight,
      };
    tip.style.maxWidth = Math.min(340, bounds.width - 24) + "px";
    const placement = tooltipPlacement(
      el.getBoundingClientRect(),
      tip.getBoundingClientRect(),
      bounds,
    );
    tip.style.left = placement.left + "px";
    tip.style.top = placement.top + "px";
    tip.dataset.side = placement.side;
    el.setAttribute(
      "aria-describedby",
      [el.getAttribute("aria-describedby"), tip.id].filter(Boolean).join(" "),
    );
    visible = true;
  }
  const target = (e) =>
    e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
  function schedule(el) {
    clearTimeout(timer);
    candidate = el;
    if (el)
      timer = setTimeout(() => {
        if (candidate === el) show(el);
      }, 360);
  }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    focusMode = false;
    const el = target(e);
    if (el !== active && el !== candidate) {
      hide();
      schedule(el);
    }
  });
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch" || focusMode) return;
      if (Math.hypot(e.clientX - lastX, e.clientY - lastY) > 3) {
        lastX = e.clientX;
        lastY = e.clientY;
        const el = target(e);
        hide();
        schedule(el);
      }
    },
    { passive: true },
  );
  document.addEventListener("pointerout", (e) => {
    const el = target(e);
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = target(e);
    if (el && el.matches(":focus-visible")) {
      focusMode = true;
      show(el);
    }
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("click", hide, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (visible) e.preventDefault();
      hide();
    }
  });
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
  window.visualViewport?.addEventListener("resize", hide);
  window.visualViewport?.addEventListener("scroll", hide);
  // Touch users can tap a static heading or field label to read its definition.
  document.addEventListener("pointerup", (e) => {
    const el = target(e);
    if (
      e.pointerType === "touch" &&
      el?.matches("h1,h2,h3,.metric-label,.stat-label,.capitol-stats span")
    )
      setTimeout(() => show(el), 0);
  });
}
