import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  typographer: false,
});
const escape = markdown.utils.escapeHtml;
export function safeArticleLink(value) {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    [...value].some(
      (character) => character.charCodeAt(0) <= 32 || character === "\\",
    )
  )
    return false;
  if (/^#[-\w]+$/.test(value) || /^\/journal(?:\/|\?|$)/.test(value))
    return true;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
markdown.validateLink = safeArticleLink;
markdown.renderer.rules.image = (tokens, index) =>
  escape(tokens[index].content);
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("rel", "noopener noreferrer");
  if (/^https?:/.test(tokens[index].attrGet("href") || ""))
    tokens[index].attrSet("target", "_blank");
  return self.renderToken(tokens, index, options);
};
markdown.renderer.rules.table_open = (tokens, index, options, env, self) =>
  `<div class="journal-table" role="region" aria-label="Article table" tabindex="0">${self.renderToken(tokens, index, options)}`;
markdown.renderer.rules.table_close = () => "</table></div>\n";

const inlineText = (tokens) =>
  tokens
    .map((token) => {
      if (["softbreak", "hardbreak"].includes(token.type)) return "\n";
      if (token.children) return inlineText(token.children);
      return token.type === "text" ||
        token.type === "code_inline" ||
        token.type === "image"
        ? token.content
        : "";
    })
    .join("");
const normalized = (text) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim();

export function formatArticle(body = "") {
  const tokens = markdown.parse(String(body), {}),
    blocks = [],
    sections = [];
  let block;
  for (const token of tokens) {
    if (
      token.level === 0 &&
      token.map &&
      (token.nesting === 1 || token.nesting === 0)
    ) {
      const id = `passage-${blocks.length + 1}`;
      token.attrSet("id", id);
      // The title owns h1. Imported Markdown headings stay within the article hierarchy.
      if (token.type === "heading_open" && token.tag === "h1") token.tag = "h2";
      block = {
        id,
        text: "",
        startLine: token.map[0],
        endLine: token.map[1],
        heading: token.type === "heading_open",
        level: Number(token.tag.slice(1)) || 0,
      };
      blocks.push(block);
      if (block.heading) sections.push(block);
    }
    if (token.type === "heading_close" && token.tag === "h1") token.tag = "h2";
    if (block && token.type === "inline")
      block.text += (block.text ? "\n" : "") + inlineText(token.children || []);
    if (block && ["fence", "code_block"].includes(token.type))
      block.text += token.content;
  }
  const plainText = blocks.map((b) => b.text).join("\n\n");
  const wordCount = plainText.trim()
    ? plainText.trim().split(/\s+/u).length
    : 0;
  return {
    html: markdown.renderer.render(tokens, markdown.options, {}),
    blocks,
    sections,
    plainText,
    wordCount,
    minutes: Math.max(1, Math.ceil(wordCount / 220)),
  };
}
export function articleContainsPassage(body, passage) {
  if (!normalized(passage)) return false;
  return (
    String(body).includes(passage) ||
    normalized(formatArticle(body).plainText).includes(normalized(passage))
  );
}
export function articlePassageAnchor(
  body,
  passage,
  formatted = formatArticle(body),
) {
  const needle = normalized(passage);
  const block = formatted.blocks.find((b) =>
    normalized(b.text).includes(needle),
  );
  if (block) return block.id;
  const start = String(body).indexOf(passage);
  if (start >= 0) {
    const line = String(body).slice(0, start).split("\n").length - 1;
    return (
      formatted.blocks.find((b) => b.startLine <= line && b.endLine > line)
        ?.id || null
    );
  }
  return (
    formatted.blocks.find(
      (b) => needle.startsWith(normalized(b.text)) && normalized(b.text),
    )?.id || null
  );
}
