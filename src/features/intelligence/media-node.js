import { Node } from "@tiptap/core";
import {
  mediaMarkdown,
  renderMedia,
  validateMedia,
} from "../../domain/article-media.js";

export const ArticleMediaNode = Node.create({
  name: "articleMedia",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  priority: 1000,
  addAttributes() {
    return { media: { default: null, rendered: false } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-article-media]",
        getAttrs: (el) => {
          try {
            return {
              media: validateMedia(JSON.parse(el.dataset.articleMedia)),
            };
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "figure",
      { "data-article-media": JSON.stringify(node.attrs.media) },
      node.attrs.media?.title || "Media",
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "writing-media-node";
      dom.contentEditable = "false";
      dom.innerHTML =
        renderMedia(node.attrs.media, { editor: true }) +
        '<div class="writing-media-actions"><button type="button" data-edit-media>Edit</button><button type="button" data-remove-media>Remove</button></div>';
      dom.onclick = (event) => {
        if (event.target.closest("[data-edit-media]")) {
          editor.commands.setNodeSelection(getPos());
          dom.dispatchEvent(
            new CustomEvent("reentry:edit-media", {
              bubbles: true,
              detail: { media: node.attrs.media },
            }),
          );
        }
        if (event.target.closest("[data-remove-media]"))
          editor
            .chain()
            .focus()
            .deleteRange({ from: getPos(), to: getPos() + node.nodeSize })
            .run();
      };
      return {
        dom,
        stopEvent: (event) => !!event.target.closest("button,a,summary"),
        destroy: () => {
          dom.onclick = null;
        },
      };
    };
  },
  markdownTokenName: "code",
  parseMarkdown(token, helpers) {
    if (token.lang !== "reentry-media") return undefined;
    try {
      return helpers.createNode("articleMedia", {
        media: validateMedia(JSON.parse(token.text)),
      });
    } catch {
      return undefined;
    }
  },
  renderMarkdown(node) {
    return mediaMarkdown(node.attrs.media);
  },
});
