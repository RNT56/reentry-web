import { portraitURL } from "./portraits.js";

export const FEATURED_PEOPLE = [
  "house_nancy_pelosi",
  "senate_richard_blumenthal",
  "house_josh_gottheimer",
];
const clean = (value, limit = 200) =>
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, limit)
    : "";

export function politicalPeople(filers, rows) {
  const people = new Map();
  for (const f of filers) {
    if (!f || !clean(f.id, 160) || !clean(f.full_name)) continue;
    const chamber = ["house", "senate"].includes(f.chamber)
      ? f.chamber
      : f.branch === "executive"
        ? "executive"
        : null;
    if (!chamber) continue;
    people.set(f.id, {
      id: clean(f.id, 160),
      name: clean(f.full_name),
      portrait: portraitURL(f.photo_url),
      chamber,
      party: ["D", "R", "I"].includes(f.party) ? f.party : null,
      state: clean(f.state, 3),
      office: clean(f.office),
      count: 0,
      buys: 0,
      sells: 0,
      latestFiled: null,
    });
  }
  for (const r of rows) {
    const p = people.get(r.memberId) || {
      id: r.memberId,
      name: r.member,
      portrait: r.portrait,
      chamber: r.chamber,
      party: r.party,
      state: r.state,
      office: r.office,
      count: 0,
      buys: 0,
      sells: 0,
      latestFiled: null,
    };
    p.count++;
    p.buys += Number(r.side === "buy");
    p.sells += Number(r.side === "sell");
    if (!p.latestFiled || r.filed > p.latestFiled) p.latestFiled = r.filed;
    people.set(p.id, p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function featuredPeople(people, limit = 12) {
  return [
    ...FEATURED_PEOPLE.map((id) => people.find((p) => p.id === id)).filter(
      Boolean,
    ),
    ...people.filter((p) => !FEATURED_PEOPLE.includes(p.id)),
  ].slice(0, limit);
}
