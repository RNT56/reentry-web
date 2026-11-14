/* Native fields remain the source of truth for forms, validation and change events. */
let installed = false;
let sequence = 0;
const controls = new Map();
let opened = null;
const chevron =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// All coordinates are CSS pixels in the layout viewport. The visual viewport
// can move independently while Safari reveals the keyboard or the user zooms.
export function selectMenuPlacement(rect, viewport, contentHeight, safe = {}) {
  const margin = 8,
    gap = 7;
  const leftEdge = viewport.left + margin + (safe.left || 0);
  const rightEdge = viewport.left + viewport.width - margin - (safe.right || 0);
  const topEdge = viewport.top + margin + (safe.top || 0);
  const bottomEdge =
    viewport.top + viewport.height - margin - (safe.bottom || 0);
  const width = Math.max(
    0,
    Math.min(Math.max(rect.width, 200), rightEdge - leftEdge),
  );
  const totalHeight = Math.max(0, bottomEdge - topEdge);
  const below = Math.max(0, bottomEdge - rect.bottom - gap);
  const above = Math.max(0, rect.top - topEdge - gap);
  const desired = Math.min(360, Math.max(0, contentHeight));
  const upwards = below < Math.min(desired, 220) && above > below;
  // A very small keyboard viewport may need to overlap the anchor; it must
  // never force an 80px box beyond the screen as the old minimum did.
  const available =
    Math.max(above, below) < 44 ? totalHeight : upwards ? above : below;
  const height = Math.min(desired, available, totalHeight);
  const top = upwards ? rect.top - gap - height : rect.bottom + gap;
  return {
    width,
    height,
    left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)),
    top: Math.max(topEdge, Math.min(top, bottomEdge - height)),
    visible:
      width > 0 &&
      height > 0 &&
      rect.bottom > topEdge &&
      rect.top < bottomEdge &&
      rect.right > leftEdge &&
      rect.left < rightEdge,
  };
}

export function revealSelectOption(panel, row) {
  const bounds = panel.getBoundingClientRect(),
    item = row.getBoundingClientRect();
  const top = bounds.top + panel.clientTop;
  const bottom = top + panel.clientHeight;
  if (item.top < top) panel.scrollTop += item.top - top;
  else if (item.bottom > bottom) panel.scrollTop += item.bottom - bottom;
}

function fieldName(select) {
  if (select.getAttribute("aria-label"))
    return select.getAttribute("aria-label");
  const labelled = select.getAttribute("aria-labelledby");
  if (labelled)
    return labelled
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
  return (
    [...(select.labels || [])]
      .map((label) => {
        const copy = label.cloneNode(true);
        copy
          .querySelectorAll("select,button,input,textarea,.select-control")
          .forEach((n) => n.remove());
        return copy.textContent.trim();
      })
      .join(" ") ||
    select.name ||
    "Choose an option"
  );
}

function enhance(select) {
  if (
    !HTMLElement.prototype.showPopover ||
    select.multiple ||
    select.size > 1 ||
    select.dataset.native !== undefined ||
    controls.has(select)
  )
    return;
  const wrapper = document.createElement("span");
  wrapper.className = "select-control";
  select.before(wrapper);
  wrapper.append(select);
  select.classList.add("select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="select-value"></span>' + chevron;
  const value = trigger.firstElementChild;
  const panel = document.createElement("div");
  panel.className = "select-menu";
  panel.id = "select-menu-" + ++sequence;
  panel.setAttribute("role", "listbox");
  panel.setAttribute("popover", "manual");
  panel.hidden = true;
  trigger.setAttribute("aria-controls", panel.id);
  wrapper.append(trigger, panel);
  let active = select.selectedIndex;
  let typed = "",
    typedAt = 0,
    signature = "";
  const enabled = () =>
    [...select.options]
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => !o.disabled && !o.hidden && !o.parentElement.disabled)
      .map(({ i }) => i);
  const state = { select, wrapper, trigger, close, sync, position };
  controls.set(select, state);

  function position() {
    if (opened !== state) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const style = getComputedStyle(panel);
    const safe = Object.fromEntries(
      ["top", "right", "bottom", "left"].map((side) => [
        side,
        parseFloat(style.getPropertyValue(`--select-safe-${side}`)) || 0,
      ]),
    );
    const bounds = {
      top: viewport?.offsetTop || 0,
      left: viewport?.offsetLeft || 0,
      height: viewport?.height || innerHeight,
      width: viewport?.width || innerWidth,
    };
    // Measure wrapping at the final width before choosing above/below.
    const width = selectMenuPlacement(
      rect,
      bounds,
      panel.scrollHeight + 2,
      safe,
    ).width;
    panel.style.width = `${width}px`;
    const placement = selectMenuPlacement(
      rect,
      bounds,
      panel.scrollHeight + 2,
      safe,
    );
    if (!placement.visible) {
      close(false);
      return;
    }
    panel.style.maxHeight = `${placement.height}px`;
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
  }
  function paintActive(scroll = true) {
    for (const row of panel.querySelectorAll("[role=option]")) {
      const index = Number(row.dataset.index);
      row.classList.toggle("is-active", index === active);
      row.setAttribute("aria-selected", String(index === select.selectedIndex));
      if (index === active) {
        trigger.setAttribute("aria-activedescendant", row.id);
        if (scroll) revealSelectOption(panel, row);
      }
    }
  }
  function rebuild() {
    panel.replaceChildren();
    let group = null;
    [...select.options].forEach((option, index) => {
      if (option.hidden) return;
      if (
        option.parentElement.tagName === "OPTGROUP" &&
        group !== option.parentElement
      ) {
        group = option.parentElement;
        const heading = document.createElement("div");
        heading.className = "select-group";
        heading.textContent = group.label;
        panel.append(heading);
      }
      const row = document.createElement("div");
      row.className = "select-option";
      row.id = panel.id + "-" + index;
      row.dataset.index = index;
      row.setAttribute("role", "option");
      row.setAttribute(
        "aria-disabled",
        String(option.disabled || option.parentElement.disabled || false),
      );
      row.textContent = option.label;
      row.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse" && enabled().includes(index)) {
          active = index;
          paintActive(false);
        }
      });
      row.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") e.preventDefault();
      });
      row.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.detail && touchGesture?.moved) return;
        commit(index);
      });
      panel.append(row);
    });
  }
  let touchGesture = null;
  panel.addEventListener(
    "pointerdown",
    (event) => {
      touchGesture =
        event.pointerType === "touch"
          ? {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              scroll: panel.scrollTop,
              moved: false,
            }
          : null;
    },
    true,
  );
  panel.addEventListener(
    "pointermove",
    (event) => {
      if (
        touchGesture?.id === event.pointerId &&
        (Math.hypot(
          event.clientX - touchGesture.x,
          event.clientY - touchGesture.y,
        ) > 8 ||
          panel.scrollTop !== touchGesture.scroll)
      )
        touchGesture.moved = true;
    },
    true,
  );
  panel.addEventListener("pointercancel", () => {
    if (touchGesture) touchGesture.moved = true;
  });
  panel.addEventListener(
    "scroll",
    () => {
      if (touchGesture && panel.scrollTop !== touchGesture.scroll)
        touchGesture.moved = true;
    },
    { passive: true },
  );
  function sync() {
    if (!select.isConnected) {
      close(false);
      controls.delete(select);
      return;
    }
    const label = select.selectedOptions[0]?.label || "Choose";
    if (value.textContent !== label) value.textContent = label;
    const name = fieldName(select);
    if (trigger.getAttribute("aria-label") !== name)
      trigger.setAttribute("aria-label", name);
    if (panel.getAttribute("aria-label") !== name)
      panel.setAttribute("aria-label", name);
    const disabled = select.matches(":disabled");
    if (trigger.disabled !== disabled) trigger.disabled = disabled;
    if (wrapper.hidden !== select.hidden) wrapper.hidden = select.hidden;
    const required = String(select.required);
    if (trigger.getAttribute("aria-required") !== required)
      trigger.setAttribute("aria-required", required);
    const invalid = select.getAttribute("aria-invalid");
    if (invalid && trigger.getAttribute("aria-invalid") !== invalid)
      trigger.setAttribute("aria-invalid", invalid);
    else if (!invalid && trigger.hasAttribute("aria-invalid"))
      trigger.removeAttribute("aria-invalid");
    const described = select.getAttribute("aria-describedby");
    if (described && trigger.getAttribute("aria-describedby") !== described)
      trigger.setAttribute("aria-describedby", described);
    else if (!described && trigger.hasAttribute("aria-describedby"))
      trigger.removeAttribute("aria-describedby");
    const next = [...select.options]
      .map((o) => [
        o.label,
        o.value,
        o.disabled,
        o.hidden,
        o.parentElement.disabled,
      ])
      .join("|");
    if (next !== signature) {
      signature = next;
      rebuild();
      if (!enabled().includes(active)) active = enabled()[0];
      trigger.removeAttribute("aria-activedescendant");
    }
    if (opened === state) {
      if (disabled || !trigger.getClientRects().length || active === undefined)
        close(false);
      else paintActive(false);
    }
  }
  function open() {
    if (select.matches(":disabled")) return;
    opened?.close(false);
    sync();
    active = enabled().includes(select.selectedIndex)
      ? select.selectedIndex
      : enabled()[0];
    if (active === undefined) return;
    opened = state;
    panel.hidden = false;
    panel.showPopover?.();
    trigger.setAttribute("aria-expanded", "true");
    position();
    if (opened !== state) return;
    paintActive();
    trigger.focus({ preventScroll: true });
  }
  function close(focus = false) {
    if (opened !== state) return;
    panel.hidePopover?.();
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    opened = null;
    if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function commit(index) {
    if (!enabled().includes(index)) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    if (select.validity.valid) select.removeAttribute("aria-invalid");
    sync();
    close(true);
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      queueMicrotask(() => controls.forEach((c) => c.sync()));
    }
  }
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    opened === state ? close() : open();
  });
  trigger.addEventListener("keydown", (e) => {
    const indices = enabled(),
      isOpen = opened === state;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (!isOpen) open();
      if (e.key === "Home") active = indices[0];
      else if (e.key === "End") active = indices.at(-1);
      else if (isOpen)
        active =
          indices[
            Math.max(
              0,
              Math.min(
                indices.length - 1,
                indices.indexOf(active) + (e.key === "ArrowDown" ? 1 : -1),
              ),
            )
          ];
      paintActive();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isOpen) commit(active);
      else open();
    } else if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const now = performance.now();
      typed = (now - typedAt > 650 ? "" : typed) + e.key.toLowerCase();
      typedAt = now;
      const match = indices.find((i) =>
        select.options[i].label.toLowerCase().startsWith(typed),
      );
      if (match !== undefined) {
        if (!isOpen) open();
        active = match;
        paintActive();
      }
    }
  });
  select.addEventListener("change", sync);
  select.addEventListener("focus", () =>
    trigger.focus({ preventScroll: true }),
  );
  select.addEventListener("invalid", (e) => {
    e.preventDefault();
    select.setAttribute("aria-invalid", "true");
    sync();
    trigger.focus();
  });
  select.form?.addEventListener("reset", () => queueMicrotask(sync));
  sync();
}

export function installControls() {
  if (installed) return;
  installed = true;
  let scheduled = false;
  function update() {
    scheduled = false;
    document
      .querySelectorAll('input[type="number"]:not([inputmode])')
      .forEach((input) => input.setAttribute("inputmode", "decimal"));
    document.querySelectorAll("select").forEach(enhance);
    controls.forEach((c) => c.sync());
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(update);
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "disabled",
      "selected",
      "label",
      "hidden",
      "required",
      "aria-label",
      "aria-invalid",
      "aria-describedby",
    ],
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (opened && !opened.wrapper.contains(e.target)) opened.close();
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    if (opened && !opened.wrapper.contains(e.target)) opened.close();
  });
  let frame = 0;
  function positionOpenMenu() {
    if (frame || !opened) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      opened?.position();
    });
  }
  document.addEventListener(
    "scroll",
    (event) => {
      if (!event.target.closest?.(".select-menu")) positionOpenMenu();
    },
    true,
  );
  window.addEventListener("resize", positionOpenMenu, { passive: true });
  window.visualViewport?.addEventListener("resize", positionOpenMenu, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", positionOpenMenu, {
    passive: true,
  });
  document.addEventListener("close", () => opened?.close(), true);
  update();
}
