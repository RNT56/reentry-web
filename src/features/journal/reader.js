import { installSurfaceMotion } from "../../shared/surface-motion.js";
import { mountChartFullscreen } from "../../shared/chart-fullscreen.js";
import { icon } from "../../shared/icons.js";
import { installReadingMotion } from "./reading-motion.js";
import { installArticleMedia } from "../../shared/article-media-runtime.js";
import { installTooltips } from "../../shared/tooltips.js";
installTooltips();
installArticleMedia();

const readingMotion = installReadingMotion();
let surfaceMotion;
function syncSurfaceMotion() {
  surfaceMotion?.destroy();
  surfaceMotion = readingMotion.reduced() ? null : installSurfaceMotion();
}
syncSurfaceMotion();
addEventListener("reentry:reading-motion", syncSurfaceMotion);
matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
  "change",
  syncSurfaceMotion,
);

// srcdoc inherits the workspace URL, so preview passage links need local scrolling.
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || !document.body.classList.contains("journal-preview")) return;
  const target = document.getElementById(link.getAttribute("href").slice(1));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: "start", behavior: "instant" });
  queueReading();
});

for (const map of document.querySelectorAll(".journal-map")) {
  map.style.setProperty(
    "--scenario-fs-branches",
    String(Math.max(1, map.querySelectorAll(".journal-scenario").length)),
  );
  const fullscreen = mountChartFullscreen(map, {
    label: () =>
      `${document.querySelector(".journal-story-head h1")?.textContent || "Journal"} · scenarios`,
    buttonHost: map.querySelector(".journal-section-heading"),
    native: true,
  });
  map.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("a[href]")) fullscreen.close();
    },
    true,
  );
}

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
        button.innerHTML = `Copied ${icon("check")}`;
        setTimeout(() => {
          button.innerHTML = `Share ${icon("arrow")}`;
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
