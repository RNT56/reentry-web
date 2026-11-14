import { esc } from "./format.js";

// Fixed vector geometry: UI symbols never depend on a platform emoji font.
export const iconPaths = {
  minus: '<path d="M5 12h14"/>',
  arrowRight: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  arrowUp: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  arrowDown: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  arrowUpLeft: '<path d="M19 19 5 5m0 12V5h12"/>',
  arrowDownRight: '<path d="m5 5 14 14M7 19h12V7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  logout: '<path d="M9 4H4v16h5m5-13 5 5-5 5M8 12h11"/>',
  passkey:
    '<circle cx="8" cy="7" r="3"/><path d="M2 20v-2a6 6 0 0 1 9-5"/><circle cx="17" cy="13" r="3"/><path d="M17 16v5m0-2h3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.3 6.3A18 18 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5.5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  swap: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  sparkles:
    '<path d="m10 3 2.5 6.5L19 12l-6.5 2.5L10 21l-2.5-6.5L1 12l6.5-2.5L10 3Zm9-2 1.1 2.9L23 5l-2.9 1.1L19 9l-1.1-2.9L15 5l2.9-1.1L19 1Z"/>',
  gemini:
    '<path d="M12 2c0 5.5-4.5 10-10 10 5.5 0 10 4.5 10 10 0-5.5 4.5-10 10-10C16.5 12 12 7.5 12 2Z"/>',
  anthropic:
    '<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5M8 3l8 18M3 8l18 8M3 16l18-8M8 21 16 3"/>',

  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 17 17 5M5 5h12v12"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
  sliders:
    '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export function icon(name, cls = "") {
  return `<svg class="icon ${esc(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name] || iconPaths.arrow}</svg>`;
}
