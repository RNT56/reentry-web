import { acquireScrollLock } from "./scroll-lock.js";
const sessions = new WeakMap();
const listening = new WeakSet();

// Coarse pointers should open a dialog before requesting the software keyboard.
export function dialogFocusTarget(dialog) {
  const explicit = dialog.querySelector("[autofocus]:not([disabled])");
  if (explicit) return explicit;
  const win = dialog.ownerDocument.defaultView;
  const touch = win.matchMedia("(any-pointer: coarse)").matches;
  return touch
    ? dialog.querySelector(".close")
    : dialog.querySelector(
        "input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled])",
      ) || dialog.querySelector(".close");
}
export function beginDialogSession(dialog) {
  let session = sessions.get(dialog);
  if (!session) {
    const doc = dialog.ownerDocument;
    session = {
      opener: doc.activeElement,
      release: acquireScrollLock(doc),
      ownedClass: !doc.documentElement.classList.contains("dialog-open"),
    };
    sessions.set(dialog, session);
    if (!listening.has(dialog)) {
      listening.add(dialog);
      dialog.addEventListener("close", () => {
        // close() events are queued; replacing a dialog must retain the new lock.
        if (!dialog.open) finishDialogSession(dialog);
      });
    }
  }
  dialog.ownerDocument.documentElement.classList.add("dialog-open");
}
export function finishDialogSession(dialog) {
  const session = sessions.get(dialog);
  if (!session) return;
  sessions.delete(dialog);
  if (session.ownedClass)
    dialog.ownerDocument.documentElement.classList.remove("dialog-open");
  session.release();
  const opener = session.opener;
  if (opener?.isConnected && !opener.closest?.("[inert]"))
    opener.focus?.({ preventScroll: true });
}
