// The server renders complete, visible text. Animation never determines visibility.
export function installReadingMotion(doc = document, win = window) {
  const media = win.matchMedia("(prefers-reduced-motion: reduce)");
  const control = doc.querySelector("[data-reading-motion]");
  const animations = new Set(),
    seen = new WeakSet();
  let preference = "system",
    observer;
  try {
    preference = win.localStorage.getItem("reentry:reading-motion") || "system";
  } catch {
    /* Private browsing can disable storage. */
  }
  const reduced = () => media.matches || preference === "reduce";
  function cancel() {
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  function sync() {
    const quiet = reduced();
    doc.documentElement.dataset.readingMotion = quiet ? "reduce" : "full";
    if (control) {
      control.setAttribute("aria-pressed", String(quiet));
      control.textContent = quiet ? "Reduced motion" : "Reduce motion";
      control.title = media.matches
        ? "Reduced motion follows your device preference"
        : "Toggle reading animations";
      control.disabled = media.matches;
    }
    if (quiet) cancel();
  }
  function stream(element) {
    if (reduced() || !element.animate || element.contains(doc.activeElement))
      return;
    const walker = doc.createTreeWalker(element, 4);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        !node.parentElement.closest("a,code,pre,.journal-stream-word") &&
        node.textContent.trim()
      )
        nodes.push(node);
    }
    let count = 0;
    for (const node of nodes) {
      const fragment = doc.createDocumentFragment();
      for (const word of node.textContent.split(/(\s+)/)) {
        if (!word.trim() || count >= 300)
          fragment.append(doc.createTextNode(word));
        else {
          const span = doc.createElement("span");
          span.className = "journal-stream-word";
          span.textContent = word;
          fragment.append(span);
          count++;
        }
      }
      node.replaceWith(fragment);
    }
    const words = [...element.querySelectorAll(".journal-stream-word")];
    const positions = words.map((word) => word.offsetTop);
    let line = -1,
      previous,
      column = 0;
    words.forEach((word, index) => {
      if (positions[index] !== previous) {
        line++;
        column = 0;
        previous = positions[index];
      }
      const delay = Math.min(300, line * 34 + column++ * 9);
      const animation = word.animate(
        [
          { opacity: 0.3, transform: "translateY(5px)", filter: "blur(1.8px)" },
          { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
        ],
        {
          duration: 440,
          delay,
          easing: "cubic-bezier(.2,.7,.2,1)",
          fill: "backwards",
        },
      );
      animations.add(animation);
      animation.finished
        .then(() => animations.delete(animation))
        .catch(() => animations.delete(animation));
    });
  }
  sync();
  if (win.IntersectionObserver) {
    observer = new win.IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting && !seen.has(entry.target)) {
            seen.add(entry.target);
            observer.unobserve(entry.target);
            stream(entry.target);
          }
      },
      { threshold: 0.05, rootMargin: "0px 0px -24px 0px" },
    );
    doc
      .querySelectorAll(
        ".journal-prose > p,.journal-prose > h2,.journal-prose > h3,.journal-prose > h4,.journal-prose > blockquote,.journal-prose > ul,.journal-prose > ol",
      )
      .forEach((element) => observer.observe(element));
  }
  control?.addEventListener("click", () => {
    preference = reduced() ? "system" : "reduce";
    try {
      win.localStorage.setItem("reentry:reading-motion", preference);
    } catch {
      /* Preference still applies to this page. */
    }
    sync();
    win.dispatchEvent(new Event("reentry:reading-motion"));
  });
  media.addEventListener("change", sync);
  win.addEventListener("storage", (event) => {
    if (event.key === "reentry:reading-motion") {
      preference = event.newValue || "system";
      sync();
      win.dispatchEvent(new Event("reentry:reading-motion"));
    }
  });
  doc.addEventListener("focusin", cancel);
  doc.addEventListener("selectionchange", () => {
    if (doc.getSelection()?.toString()) cancel();
  });
  win.addEventListener("pagehide", () => {
    cancel();
    observer?.disconnect();
  });
  return { reduced, cancel };
}
