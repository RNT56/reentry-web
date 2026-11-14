import { installSurfaceMotion } from "../../shared/surface-motion.js";

installSurfaceMotion();

const progress = document.querySelector(".journal-progress");
const prose = document.querySelector(".journal-prose");
const tools = document.querySelector(".journal-reading-tools");
const storyHead = document.querySelector(".journal-story-head");
const sectionLinks = [...document.querySelectorAll(".journal-reading-rail a")];
const sections = sectionLinks
  .map((link) => ({
    link,
    target: document.getElementById(link.hash.slice(1)),
  }))
  .filter(({ target }) => target);
let queued = false;
let activeSection;
function updateReading() {
  queued = false;
  if (!prose || !progress) return;
  const toolbarHeight = tools?.getBoundingClientRect().height || 0;
  const rect = prose.getBoundingClientRect();
  const range = Math.max(1, rect.height - innerHeight * 0.45);
  progress.style.transform = `scaleX(${Math.max(0, Math.min(1, (innerHeight * 0.2 - rect.top) / range))})`;
  tools?.classList.toggle(
    "is-reading",
    !!storyHead && storyHead.getBoundingClientRect().bottom <= toolbarHeight,
  );
  const readingLine = toolbarHeight + Math.min(100, innerHeight * 0.15);
  let current;
  for (const section of sections) {
    if (section.target.getBoundingClientRect().top <= readingLine)
      current = section;
  }
  if (current !== activeSection) {
    activeSection = current;
    sections.forEach(({ link }) => {
      if (link === current?.link) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
}
function queueReading() {
  if (!queued) {
    queued = true;
    requestAnimationFrame(updateReading);
  }
}
addEventListener("scroll", queueReading, { passive: true });
addEventListener("resize", queueReading);
addEventListener("pageshow", queueReading);
document.fonts?.ready.then(queueReading);
updateReading();
document
  .querySelector("[data-reading-focus]")
  ?.addEventListener("click", (event) => {
    const readingLine = (tools?.getBoundingClientRect().height || 0) + 30;
    const anchor = [...document.querySelectorAll(".journal-prose > *")].find(
      (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= readingLine && rect.bottom > readingLine;
      },
    );
    const previousTop = anchor?.getBoundingClientRect().top;
    const focused = document.body.classList.toggle("journal-focused");
    const button = event.currentTarget;
    button.setAttribute("aria-pressed", String(focused));
    button.setAttribute(
      "aria-label",
      focused ? "Exit focused reading" : "Enable focused reading",
    );
    button.textContent = focused ? "Exit focus" : "Focus";
    if (anchor)
      scrollBy({
        top: anchor.getBoundingClientRect().top - previousTop,
        behavior: "instant",
      });
    queueReading();
  });
document
  .querySelector("[data-reading-share]")
  ?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      if (navigator.share)
        await navigator.share({ title: document.title, url: location.href });
      else {
        await navigator.clipboard.writeText(location.href);
        document.querySelector("#journal-announcement").textContent =
          "Link copied";
        button.textContent = "Copied ✓";
        setTimeout(() => {
          button.textContent = "Share ↗";
        }, 2200);
      }
    } catch (error) {
      if (error.name !== "AbortError")
        document.querySelector("#journal-announcement").textContent =
          "Sharing unavailable";
    }
  });
document.querySelectorAll(".journal-asset img").forEach((img) => {
  img.addEventListener(
    "error",
    () => {
      img.hidden = true;
    },
    { once: true },
  );
  if (img.complete && !img.naturalWidth) img.hidden = true;
});
