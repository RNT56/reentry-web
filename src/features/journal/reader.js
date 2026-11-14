const progress = document.querySelector(".journal-progress");
const prose = document.querySelector(".journal-prose");
let queued = false;
function updateProgress() {
  queued = false;
  if (!prose || !progress) return;
  const rect = prose.getBoundingClientRect();
  const range = Math.max(1, rect.height - innerHeight * 0.45);
  progress.style.transform = `scaleX(${Math.max(0, Math.min(1, (innerHeight * 0.2 - rect.top) / range))})`;
}
function queueProgress() {
  if (!queued) {
    queued = true;
    requestAnimationFrame(updateProgress);
  }
}
addEventListener("scroll", queueProgress, { passive: true });
addEventListener("resize", queueProgress);
updateProgress();
document
  .querySelector("[data-reading-focus]")
  ?.addEventListener("click", (event) => {
    const focused = document.body.classList.toggle("journal-focused");
    event.currentTarget.setAttribute("aria-pressed", String(focused));
    event.currentTarget.textContent = focused ? "Exit focus" : "Focus";
  });
document
  .querySelector("[data-reading-share]")
  ?.addEventListener("click", async () => {
    try {
      if (navigator.share)
        await navigator.share({ title: document.title, url: location.href });
      else {
        await navigator.clipboard.writeText(location.href);
        document.querySelector("#journal-announcement").textContent =
          "Link copied";
      }
    } catch {
      /* Dismissing the share sheet leaves reading uninterrupted. */
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
if ("IntersectionObserver" in window) {
  const links = [...document.querySelectorAll(".journal-reading-rail a")];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          links.forEach((link) => {
            if (link.getAttribute("href") === "#" + entry.target.id)
              link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
          });
        }
    },
    { rootMargin: "-10% 0px -65% 0px" },
  );
  links.forEach((link) => {
    const target = document.getElementById(link.hash.slice(1));
    if (target) observer.observe(target);
  });
}
