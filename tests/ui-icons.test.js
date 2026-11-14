import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { icon, iconPaths } from "../src/shared/icons.js";
import { accountCard } from "../src/features/identity/session.js";

const project = new URL("../", import.meta.url);

async function sourceFiles(directory, extensions) {
  const result = [];
  for (const entry of await readdir(new URL(directory, project), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory())
      result.push(...(await sourceFiles(path, extensions)));
    else if (extensions.some((extension) => path.endsWith(extension)))
      result.push(path);
  }
  return result;
}

// Escapes and numeric entities must not sneak font glyphs back into templates.
function decodeCharacters(source) {
  return source
    .replace(
      /\\u\{([\da-f]+)\}|\\u([\da-f]{4})|\\x([\da-f]{2})/gi,
      (_, braced, unicode, hex) =>
        String.fromCodePoint(parseInt(braced || unicode || hex, 16)),
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, value) =>
      String.fromCodePoint(
        value[0].toLowerCase() === "x"
          ? parseInt(value.slice(1), 16)
          : Number(value),
      ),
    );
}

test("shared UI symbols contain accessible vector geometry without font glyphs", () => {
  assert.ok(Object.keys(iconPaths).length > 0);
  for (const name of Object.keys(iconPaths)) {
    const markup = icon(name);
    assert.match(markup, /^<svg\b/, name);
    assert.match(markup, /viewBox="0 0 24 24"/, name);
    assert.match(markup, /aria-hidden="true"/, name);
    assert.match(markup, /focusable="false"/, name);
    assert.match(
      markup,
      /<(?:path|circle|rect|line|polyline|polygon|ellipse)\b/,
      name,
    );
    assert.doesNotMatch(markup, /<(?:text|foreignObject|image)\b/i, name);
    assert.ok(
      [...markup].every((character) => character.codePointAt(0) < 128),
      name,
    );
    assert.equal(markup.replace(/<[^>]+>/g, "").trim(), "", name);
  }
});

test("literal icon calls across client and public journal use registered symbols", async () => {
  const files = [
    ...(await sourceFiles("src", [".js"])),
    ...(await sourceFiles("server/journal", [".js"])),
  ];
  const missing = [];
  let calls = 0;
  for (const path of files) {
    const source = await readFile(new URL(path, project), "utf8");
    for (const match of source.matchAll(/\bicon\(\s*(["'`])([\w-]+)\1/g)) {
      calls++;
      if (!Object.hasOwn(iconPaths, match[2]))
        missing.push(`${path}: ${match[2]}`);
    }
  }
  assert.ok(calls > 0, "The scan must find production icon calls");
  assert.deepEqual(
    missing,
    [],
    "Unknown names silently fall back to another icon",
  );
});

test("mobile UI templates and styles do not reintroduce decorative text icons", async () => {
  const files = [
    ...(await sourceFiles("src/features", [".js"])),
    ...(await sourceFiles("server/journal", [".js"])),
    ...(await sourceFiles("src/styles", [".css"])),
  ];
  const failures = [];
  const decorativeGlyph = /[◉✦↗↖↘↙↻↶↷⇄＋]|\ufe0f|\p{Emoji_Presentation}/u;
  for (const path of files) {
    const source = decodeCharacters(
      await readFile(new URL(path, project), "utf8"),
    );
    for (const [index, line] of source.split("\n").entries()) {
      const symbol = line.match(decorativeGlyph);
      if (symbol) failures.push(`${path}:${index + 1}: ${symbol[0]}`);
      if (path.endsWith(".css") && /\bcontent\s*:\s*(["'])[+−]\1/.test(line))
        failures.push(`${path}:${index + 1}: font-based disclosure control`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    "Use vector geometry for decorative UI controls",
  );
});

test("account passkey actions use decorative SVG while keeping readable labels", () => {
  const markup = accountCard({ username: "Mobile<QA>" });
  assert.match(markup, /Mobile&lt;QA&gt;/);
  const passkeys = markup.match(
    /<button[^>]*id="passkeys"[^>]*>([\s\S]*?)<\/button>/,
  )?.[1];
  assert.ok(passkeys, "Passkey settings must remain reachable");
  assert.match(passkeys, /<svg\b/);
  assert.equal(passkeys.replace(/<[^>]+>/g, "").trim(), "Passkeys");
  assert.match(markup, /id="sign-out"/);
  assert.doesNotMatch(markup, /[◉↗]/);
});

test("escaped legacy control symbols are included in the regression scan", () => {
  assert.equal(
    decodeCharacters("\\u2197 &#x21bb; &#8599; \\u{1f511}"),
    "↗ ↻ ↗ 🔑",
  );
});
