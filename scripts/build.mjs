import { build } from "esbuild";
import { mkdir, copyFile, cp, rm } from "node:fs/promises";
await rm("dist/public", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  outfile: "dist/public/app.js",
  legalComments: "eof",
});
await copyFile("src/style.css", "dist/public/style.css");
await copyFile("src/index.html", "dist/public/index.html");
await cp("public", "dist/public", { recursive: true });
await mkdir("dist/public/fonts", { recursive: true });
await copyFile(
  "node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  "dist/public/fonts/dm-sans.woff2",
);
await copyFile(
  "node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  "dist/public/fonts/manrope.woff2",
);
for (const font of ["dm-sans", "manrope"])
  await copyFile(
    `node_modules/@fontsource-variable/${font}/LICENSE`,
    `dist/public/fonts/${font}-LICENSE.txt`,
  );
console.log("Built dist/public");
