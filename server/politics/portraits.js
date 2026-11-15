export function portraitURL(value) {
  const match = String(value || "").match(
    /^https:\/\/unitedstates\.github\.io\/images\/congress\/(?:225x275|450x550)\/([A-Z]\d{6})\.jpg$/,
  );
  return match
    ? `https://unitedstates.github.io/images/congress/225x275/${match[1]}.jpg`
    : null;
}
