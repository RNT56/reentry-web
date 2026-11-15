import { beginDialogSession, finishDialogSession } from "./dialog-session.js";

/** A top-layer reader; the underlying workspace stays mounted and keeps its viewport. */
export function openSlideOver({ markup, onClose = () => {} }) {
  const dialog = document.createElement("dialog");
  dialog.className = "asset-drawer";
  dialog.setAttribute("aria-labelledby", "asset-drawer-title");
  dialog.innerHTML = markup;
  let disposed = false,
    closing = false,
    timer,
    animation;
  const reduced = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finish = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    animation?.cancel();
    onClose();
    if (dialog.open) dialog.close();
    finishDialogSession(dialog);
    dialog.remove();
  };
  const close = () => {
    if (disposed || closing) return;
    closing = true;
    if (reduced() || !dialog.animate) return finish();
    animation?.cancel();
    animation = dialog.animate(
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(32px)", opacity: 0 },
      ],
      { duration: 160, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" },
    );
    timer = setTimeout(finish, 180);
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", finish);
  let outsideDown = false;
  const outside = (e) => {
    const b = dialog.getBoundingClientRect();
    return (
      e.target === dialog &&
      (e.clientX < b.left ||
        e.clientX > b.right ||
        e.clientY < b.top ||
        e.clientY > b.bottom)
    );
  };
  dialog.addEventListener("pointerdown", (event) => {
    outsideDown = outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (outsideDown && outside(event)) close();
    outsideDown = false;
  });
  document.body.append(dialog);
  beginDialogSession(dialog);
  try {
    dialog.showModal();
  } catch (error) {
    finish();
    throw error;
  }
  dialog.querySelector("[data-drawer-close]").addEventListener("click", close);
  dialog.querySelector("[data-drawer-close]").focus({ preventScroll: true });
  if (!reduced() && dialog.animate)
    animation = dialog.animate(
      [
        { transform: "translateX(40px)", opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 230, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  return {
    dialog,
    close,
    destroy: finish,
    isOpen: () => !disposed && !closing,
  };
}
