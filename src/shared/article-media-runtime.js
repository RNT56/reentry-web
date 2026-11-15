import { dataCSV, validateMedia } from "../domain/article-media.js";
export function installArticleMedia(root = document) {
  const click = (event) => {
    const figure = event.target.closest("figure[data-article-media]");
    if (!figure || figure.closest(".writing-media-node")) return;
    let media;
    try {
      media = validateMedia(JSON.parse(figure.dataset.articleMedia));
    } catch {
      return;
    }
    if (
      event.target.closest("[data-play-youtube]") &&
      media.type === "youtube"
    ) {
      const frame = document.createElement("iframe");
      frame.title = media.title || "YouTube video";
      frame.src = `https://www.youtube-nocookie.com/embed/${media.videoId}?start=${media.start}&playsinline=1`;
      frame.allow =
        "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allowFullscreen = true;
      const video = figure.querySelector(".media-video"),
        link = video.querySelector("a");
      video.replaceChildren(frame);
      if (link) {
        link.className = "media-video-source";
        video.after(link);
      }
    }
    if (event.target.closest("[data-download-media]") && media.columns) {
      // Spreadsheet formula-like labels are exported as literal text.
      const safe = {
        ...media,
        columns: media.columns.map((c) => (/^[=+@-]/.test(c) ? "'" + c : c)),
        rows: media.rows.map((r) =>
          r.map((c) =>
            typeof c === "string" && /^[=+@-]/.test(c) ? "'" + c : c,
          ),
        ),
      };
      const url = URL.createObjectURL(
        new Blob([dataCSV(safe)], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (media.title || "article-data")
          .replace(/[^a-z0-9_-]+/gi, "-")
          .slice(0, 80) + ".csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
}
