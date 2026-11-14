/* The identity stays vector-native and transparent at every size. */
export const reentryMarkPaths =
  '<path class="reentry-soil" d="M5 49c11 2 20-1 26-9 5-7 6-16 12-20-3 9-3 17-8 25-7 12-19 16-30 11Z" fill="#07140e"/><path class="reentry-wave" d="M5 48c11 0 16-8 20-20 4-13 13-21 24-19 11 2 16 12 11 22-4 9-16 12-23 5-5-5-4-13 2-17 5-3 11-1 14 3-6-4-12 0-10 6 2 5 9 5 12 0 4-7-1-14-8-13-10 1-12 13-16 24-5 13-16 18-26 15Z" fill="#08734d"/><path class="reentry-crest" d="M14 47c8-3 10-13 14-22C33 13 41 8 49 10c9 2 13 9 11 16-1-9-7-14-14-12-9 2-12 13-16 23-3 6-7 10-13 12Z" fill="#24b878"/><path class="reentry-lip" d="M39 20c5-3 11-1 14 2-6-4-12 0-10 6 1 3 4 4 7 3-6 3-12 0-12-5 0-2 0-4 1-6Z" fill="#54d99a"/><path class="reentry-earth-line" d="M6 56h9m4-2h5m4-3h4" fill="none" stroke="#0e3b28" stroke-width="1.2" stroke-linecap="round"/>';
export function brandMark() {
  return `<svg class="reentry-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">${reentryMarkPaths}</svg>`;
}
