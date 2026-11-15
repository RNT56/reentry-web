import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { formatArticle, safeArticleLink } from "../../domain/article-format.js";
import { esc } from "../../shared/format.js";
import { modal, close, toast, icon } from "../../shared/ui.js";

const button = (command, text, label) =>
  `<button type="button" data-write-command="${command}" aria-label="${label}" title="${label}">${text}</button>`;
export function writingEditorMarkup(body) {
  return `<section class="writing-surface" aria-label="Article editor" data-motion-static>
    <div class="writing-topline"><div class="writing-mode" role="group" aria-label="Editor view"><button type="button" data-write-mode="rich" aria-pressed="true">Write</button><button type="button" data-write-mode="source" aria-pressed="false">Markdown</button></div><span data-writing-stats></span><button type="button" data-writing-find>Find & replace</button></div>
    <div class="writing-toolbar" role="toolbar" aria-label="Text formatting">
      <label class="sr-only" for="writing-block">Text style</label><select id="writing-block" aria-label="Text style"><option value="paragraph">Paragraph</option><option value="2">Heading 2</option><option value="3">Heading 3</option><option value="4">Heading 4</option></select>
      <span class="writing-tool-group">${button("bold", "<b>B</b>", "Bold (⌘/Ctrl+B)")}${button("italic", "<i>I</i>", "Italic (⌘/Ctrl+I)")}${button("strike", "<s>S</s>", "Strikethrough")}</span>
      <span class="writing-tool-group">${button("bulletList", "• List", "Bullet list")}${button("orderedList", "1. List", "Numbered list")}${button("blockquote", "❝", "Block quote")}${button("link", "Link", "Add or edit link")}</span>
      <span class="writing-tool-group">${button("table", "Table", "Insert table")}${button("horizontalRule", "Divider", "Insert divider")}${button("code", "&lt;/&gt;", "Inline code")}${button("clear", "Tx", "Clear formatting")}</span>
      <span class="writing-tool-group">${button("undo", icon("undo"), "Undo (⌘/Ctrl+Z)")}${button("redo", icon("redo"), "Redo (⌘/Ctrl+Shift+Z)")}</span>
    </div>
    <div class="writing-table-tools" hidden><span>Table</span>${button("addRowAfter", "+ Row", "Add row below")}${button("addColumnAfter", "+ Column", "Add column after")}${button("deleteRow", "− Row", "Delete table row")}${button("deleteColumn", "− Column", "Delete table column")}${button("deleteTable", "Remove", "Remove table")}</div>
    <div class="writing-find" hidden><label>Find<input name="writing-find" maxlength="500" placeholder="Find in article"></label><label>Replace with<input name="writing-replace" maxlength="1000" placeholder="Replacement"></label><button type="button" data-writing-find-next>Find next</button><button type="button" data-writing-replace-one>Replace</button><button type="button" data-writing-find-close aria-label="Close find and replace">${icon("close")}</button></div>
    <div class="writing-canvas" data-writing-canvas></div>
    <label class="sr-only" for="article-body">Article Markdown</label><textarea class="article-textarea writing-source" id="article-body" name="article-body" maxlength="40000" spellcheck="true" hidden>${esc(body)}</textarea>
    <div class="writing-footer"><span data-writing-selection>Select text to revise or map a passage.</span><span data-writing-limit></span></div>
  </section>`;
}

// A text-to-document position map also handles bold/italic marks splitting a quote.
function textPositions(doc) {
  let text = "";
  const positions = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text.length; i++) {
        positions.push(pos + i);
        text += node.text[i];
      }
    } else if ((node.isBlock && text) || node.type.name === "hardBreak") {
      text += "\n";
      positions.push(pos);
    }
  });
  return { text, positions };
}

export function createWritingEditor(
  root,
  { body = "", onChange = () => {} } = {},
) {
  const source = root.querySelector("#article-body"),
    canvas = root.querySelector("[data-writing-canvas]");
  let markdown = body,
    mode = "rich",
    selection = null,
    statTimer;
  const sourcePast = [],
    sourceFuture = [];
  function rememberSource() {
    sourcePast.push(markdown);
    if (sourcePast.length > 100) sourcePast.shift();
    sourceFuture.length = 0;
  }
  function sourceHistory(command) {
    const from = command === "undo" ? sourcePast : sourceFuture;
    const to = command === "undo" ? sourceFuture : sourcePast;
    if (!from.length) return;
    to.push(markdown);
    source.value = markdown = from.pop();
    source.focus();
    selection = capture();
    changed();
  }
  const editor = new Editor({
    element: canvas,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        underline: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          isAllowedUri: safeArticleLink,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
      TableKit.configure({
        table: { resizable: false, allowTableNodeSelection: true },
      }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    // Parse with the same safe renderer used by the finished article.
    content: formatArticle(body).html,
    editorProps: {
      attributes: {
        class: "writing-prose",
        role: "textbox",
        "aria-label": "Article text",
        "aria-multiline": "true",
        spellcheck: "true",
        "data-placeholder": "Start with one idea. Build the argument here.",
      },
    },
    onUpdate: () => {
      markdown = editor.getMarkdown();
      source.value = markdown;
      changed();
    },
    onSelectionUpdate: () => {
      selection = capture();
      refreshTools();
    },
  });
  function capture() {
    if (mode === "source")
      return {
        mode,
        from: source.selectionStart,
        to: source.selectionEnd,
        text: source.value.slice(source.selectionStart, source.selectionEnd),
        body: markdown,
      };
    const { from, to } = editor.state.selection;
    return {
      mode,
      from,
      to,
      text: editor.state.doc.textBetween(from, to, "\n"),
      body: markdown,
    };
  }
  function stats() {
    const formatted = formatArticle(markdown);
    root.querySelector("[data-writing-stats]").textContent =
      `${formatted.wordCount.toLocaleString()} words · ${formatted.minutes} min read`;
    const limit = root.querySelector("[data-writing-limit]");
    limit.textContent = `${markdown.length.toLocaleString()} / 40,000`;
    limit.classList.toggle("is-over-limit", markdown.length > 40000);
  }
  function changed() {
    clearTimeout(statTimer);
    statTimer = setTimeout(stats, 160);
    onChange(markdown);
    refreshTools();
  }
  function refreshTools() {
    const selected = capture();
    root.querySelector("[data-writing-selection]").textContent = selected.text
      ? `${selected.text.trim().split(/\s+/).length} words selected · ready for AI or scenario mapping`
      : "Select text to revise or map a passage.";
    root.querySelectorAll("[data-write-command]").forEach((b) => {
      const command = b.dataset.writeCommand;
      b.disabled = mode === "source";
      if (
        [
          "bold",
          "italic",
          "strike",
          "bulletList",
          "orderedList",
          "blockquote",
          "code",
          "link",
        ].includes(command)
      )
        b.setAttribute("aria-pressed", String(editor.isActive(command)));
      if (command === "undo")
        b.disabled =
          mode === "source" ? !sourcePast.length : !editor.can().undo();
      if (command === "redo")
        b.disabled =
          mode === "source" ? !sourceFuture.length : !editor.can().redo();
    });
    root.querySelector("#writing-block").disabled = mode === "source";
    root.querySelector("#writing-block").value = editor.isActive("heading")
      ? String(editor.getAttributes("heading").level)
      : "paragraph";
    root.querySelector(".writing-table-tools").hidden =
      mode === "source" || !editor.isActive("table");
  }
  function setMode(next) {
    if (mode === next) return;
    if (next === "rich")
      editor.commands.setContent(formatArticle(markdown).html, {
        emitUpdate: false,
      });
    mode = next;
    source.hidden = next !== "source";
    canvas.hidden = next === "source";
    root
      .querySelectorAll("[data-write-mode]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.writeMode === next)),
      );
    if (next === "source") {
      sourcePast.length = sourceFuture.length = 0;
      source.value = markdown;
      source.style.height = Math.max(500, canvas.scrollHeight) + "px";
      source.focus();
    } else editor.commands.focus();
    selection = capture();
    refreshTools();
  }
  function rangeFor(text, start = 0, unique = false) {
    const mapped = textPositions(editor.state.doc);
    let index = mapped.text.indexOf(text, start);
    if (index < 0 && start) index = mapped.text.indexOf(text);
    return index < 0 || (unique && mapped.text.indexOf(text, index + 1) >= 0)
      ? null
      : {
          from: mapped.positions[index],
          to: mapped.positions[index + text.length - 1] + 1,
        };
  }
  function replaceRange(range, content) {
    if (mode === "source") {
      rememberSource();
      source.setRangeText(content, range.from, range.to, "end");
      markdown = source.value;
      changed();
    } else
      editor
        .chain()
        .focus()
        .insertContentAt(range, formatArticle(content).html)
        .run();
    selection = capture();
  }
  function apply(content, destination, context) {
    if (context && context.body !== markdown)
      throw Error(
        "The article changed since this suggestion. Review it again or copy the text.",
      );
    if (markdown.length + content.length > 40000 && destination !== "replace")
      throw Error("This would exceed the 40,000-character article limit.");
    if (destination === "replace") {
      if (content.length > 40000)
        throw Error("This exceeds the article length limit.");
      if (mode === "source") {
        rememberSource();
        source.value = content;
        markdown = content;
        changed();
      } else
        editor
          .chain()
          .focus()
          .selectAll()
          .insertContent(formatArticle(content).html)
          .run();
    } else if (destination === "append") {
      if (mode === "source")
        replaceRange(
          { from: markdown.length, to: markdown.length },
          "\n\n" + content,
        );
      else
        editor
          .chain()
          .focus("end")
          .insertContentAt(
            editor.state.doc.content.size,
            formatArticle(content).html,
          )
          .run();
    } else {
      if (!context) throw Error("Select an insertion point or passage first.");
      const sourceIndex =
        mode === "source" && context.text ? markdown.indexOf(context.text) : -1;
      const range =
        context.mode === mode
          ? { from: context.from, to: context.to }
          : context.text
            ? mode === "rich"
              ? rangeFor(context.text, 0, true)
              : sourceIndex >= 0 &&
                  markdown.indexOf(context.text, sourceIndex + 1) < 0
                ? { from: sourceIndex, to: sourceIndex + context.text.length }
                : null
            : null;
      if (!range) throw Error("Select the passage again before inserting.");
      replaceRange(range, content);
    }
    stats();
  }
  root.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-write-command]")) event.preventDefault();
  });
  root.onclick = (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.writeMode) setMode(b.dataset.writeMode);
    if (b.hasAttribute("data-writing-find")) {
      root.querySelector(".writing-find").hidden = false;
      root.querySelector('[name="writing-find"]').focus();
    }
    if (b.hasAttribute("data-writing-find-close"))
      root.querySelector(".writing-find").hidden = true;
    if (b.hasAttribute("data-writing-find-next")) {
      const query = root.querySelector('[name="writing-find"]').value;
      if (!query) return;
      if (mode === "source") {
        const pos = markdown.indexOf(query, source.selectionEnd);
        const index = pos < 0 ? markdown.indexOf(query) : pos;
        if (index < 0) return toast("No matching text.");
        source.focus();
        source.setSelectionRange(index, index + query.length);
      } else {
        const mapped = textPositions(editor.state.doc);
        const start = mapped.positions.findIndex(
          (p) => p >= editor.state.selection.to,
        );
        const range = rangeFor(query, Math.max(0, start));
        if (!range) return toast("No matching text.");
        editor.chain().focus().setTextSelection(range).scrollIntoView().run();
      }
      selection = capture();
      refreshTools();
    }
    if (b.hasAttribute("data-writing-replace-one")) {
      const query = root.querySelector('[name="writing-find"]').value,
        replacement = root.querySelector('[name="writing-replace"]').value;
      if (!query || capture().text !== query)
        return toast("Find the text before replacing it.");
      if (mode === "source") replaceRange(capture(), replacement);
      else {
        const chain = editor.chain().focus();
        if (replacement)
          chain.insertContent({ type: "text", text: replacement }).run();
        else chain.deleteSelection().run();
      }
    }
    const command = b.dataset.writeCommand;
    if (mode === "source" && ["undo", "redo"].includes(command)) {
      sourceHistory(command);
      return;
    }
    if (!command || mode !== "rich") return;
    if (command === "link") {
      const range = {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        },
        href = editor.getAttributes("link").href || "";
      modal(
        `<h2>Link this passage</h2><form id="writing-link-form"><label for="writing-link-url">Destination</label><input id="writing-link-url" type="url" placeholder="https://" value="${esc(href)}"><div class="actions"><button class="primary" type="submit">Apply link</button><button type="button" class="secondary" data-writing-unlink>Remove link</button></div></form>`,
      );
      document.querySelector("#writing-link-form").onsubmit = (e) => {
        e.preventDefault();
        const value = document.querySelector("#writing-link-url").value.trim();
        if (!safeArticleLink(value))
          return toast("Use a valid HTTP or HTTPS link.");
        editor
          .chain()
          .focus()
          .setTextSelection({ from: range.from, to: range.to })
          .extendMarkRange("link")
          .setLink({ href: value })
          .run();
        close();
      };
      document.querySelector("[data-writing-unlink]").onclick = () => {
        editor.chain().focus().unsetLink().run();
        close();
      };
      return;
    }
    const chain = editor.chain().focus();
    const commands = {
      bold: "toggleBold",
      italic: "toggleItalic",
      strike: "toggleStrike",
      bulletList: "toggleBulletList",
      orderedList: "toggleOrderedList",
      blockquote: "toggleBlockquote",
      code: "toggleCode",
      horizontalRule: "setHorizontalRule",
      undo: "undo",
      redo: "redo",
      addRowAfter: "addRowAfter",
      addColumnAfter: "addColumnAfter",
      deleteRow: "deleteRow",
      deleteColumn: "deleteColumn",
      deleteTable: "deleteTable",
    };
    if (command === "table")
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (command === "clear") chain.unsetAllMarks().clearNodes().run();
    else if (commands[command]) chain[commands[command]]().run();
    refreshTools();
  };
  root.querySelector("#writing-block").onchange = (e) => {
    const chain = editor.chain().focus();
    if (e.target.value === "paragraph") chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(e.target.value) }).run();
  };
  source.oninput = () => {
    rememberSource();
    markdown = source.value;
    selection = capture();
    changed();
  };
  source.onkeydown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      sourceHistory(event.shiftKey ? "redo" : "undo");
    }
  };
  source.onbeforeinput = (event) => {
    if (["historyUndo", "historyRedo"].includes(event.inputType)) {
      event.preventDefault();
      sourceHistory(event.inputType === "historyUndo" ? "undo" : "redo");
    }
  };
  source.onselect = () => {
    selection = capture();
    refreshTools();
  };
  stats();
  refreshTools();
  return {
    getBody: () => markdown,
    selection: () => ({ ...(selection || capture()), body: markdown }),
    apply,
    replaceQuote(quote, replacement, expected) {
      if (expected !== markdown)
        throw Error(
          "The article changed. Run a new check before applying this correction.",
        );
      if (mode === "source") {
        const index = markdown.indexOf(quote);
        if (index < 0 || markdown.indexOf(quote, index + 1) >= 0)
          throw Error(
            "Find the quoted passage and review the correction manually.",
          );
        replaceRange({ from: index, to: index + quote.length }, replacement);
      } else {
        const mapped = textPositions(editor.state.doc),
          index = mapped.text.indexOf(quote);
        if (index < 0 || mapped.text.indexOf(quote, index + 1) >= 0)
          throw Error(
            "Find the quoted passage and review the correction manually.",
          );
        const range = rangeFor(quote);
        const chain = editor.chain().focus().setTextSelection(range);
        if (replacement)
          chain.insertContent({ type: "text", text: replacement }).run();
        else chain.deleteSelection().run();
      }
    },
    focus: () => (mode === "rich" ? editor.commands.focus() : source.focus()),
    destroy() {
      clearTimeout(statTimer);
      editor.destroy();
      root.onclick = null;
    },
  };
}
