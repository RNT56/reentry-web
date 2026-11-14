/** Keep global chrome out of editing and preserve the active planner context. */
export function mountViewport(root) {
  let frame = 0;
  let holdings = null;
  let viewportWidth = window.innerWidth;
  let unoccludedHeight = window.innerHeight;
  const viewport = window.visualViewport;
  function update() {
    frame = 0;
    const shell = root.querySelector(".shell");
    const focused = document.activeElement;
    const editing = focused?.matches(
      "input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]",
    );
    if (!editing || viewportWidth !== window.innerWidth) {
      viewportWidth = window.innerWidth;
      unoccludedHeight = window.innerHeight;
    }
    const keyboardOpen =
      window.matchMedia("(max-width: 850px)").matches &&
      editing &&
      viewport &&
      Math.max(window.innerHeight, unoccludedHeight) - viewport.height > 120;
    document.documentElement.classList.toggle("keyboard-open", !!keyboardOpen);
    if (!shell) return;
    const headerHeight = shell.querySelector(".app-header")?.offsetHeight || 64;
    const availableHeight = viewport?.height || window.innerHeight;
    const planner = shell.querySelector(".planner");
    const target = shell.querySelector(".ceiling");
    const plannerRect = planner?.getBoundingClientRect();
    const targetRect = target?.getBoundingClientRect();
    const inPlanner =
      plannerRect &&
      plannerRect.top < headerHeight + 40 &&
      plannerRect.bottom > headerHeight + 180;
    const targetVisible =
      targetRect &&
      targetRect.top >= headerHeight + 8 &&
      targetRect.bottom <= availableHeight - 94;
    shell.classList.toggle(
      "dock-visible",
      !!inPlanner && !targetVisible && !keyboardOpen,
    );
    const nextHoldings = shell.querySelector(".holdings-list");
    if (nextHoldings && nextHoldings !== holdings) {
      holdings = nextHoldings;
      const selected = holdings.querySelector(".selected");
      if (selected) {
        const listRect = holdings.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        if (window.matchMedia("(min-width: 851px)").matches) {
          if (selectedRect.bottom > listRect.bottom)
            holdings.scrollTop += selectedRect.bottom - listRect.bottom + 8;
          else if (selectedRect.top < listRect.top)
            holdings.scrollTop += selectedRect.top - listRect.top - 8;
        } else if (selectedRect.right > listRect.right) {
          holdings.scrollLeft += selectedRect.right - listRect.right + 8;
        } else if (selectedRect.left < listRect.left) {
          holdings.scrollLeft += selectedRect.left - listRect.left - 8;
        }
      }
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  viewport?.addEventListener("resize", schedule, { passive: true });
  viewport?.addEventListener("scroll", schedule, { passive: true });
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  schedule();
  return {
    refresh: schedule,
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      document.documentElement.classList.remove("keyboard-open");
    },
  };
}
