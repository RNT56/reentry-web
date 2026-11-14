import js from "@eslint/js";
import globals from "globals";
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  { files: ["src/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: [
      "server/**/*.js",
      "scripts/**/*.mjs",
      "tests/**/*.js",
      "eslint.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/domain/**/*.js"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "fetch",
        "localStorage",
        "sessionStorage",
      ],
      "no-restricted-imports": [
        "error",
        { patterns: ["**/features/**", "**/app/**", "**/server/**"] },
      ],
    },
  },
  {
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];
