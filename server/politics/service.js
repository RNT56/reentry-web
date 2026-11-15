import { createPoliticalFeed } from "./feed.js";
import {
  createPoliticalHistory,
  officialDocument,
  HISTORY_SOURCE,
} from "./history.js";
import { politicalPeople } from "./people.js";
import { congressIdentity } from "./career.js";
import congress from "./catalog/congress.json" with { type: "json" };
import portraits from "./catalog/portraits.json" with { type: "json" };

export function mergePoliticalSources(live, history) {
  const aliases = {},
    directory = new Map();
  for (const p of live.people || []) {
    const bioguide = p.portrait?.match(/([A-Z]\d{6})\.jpg$/)?.[1],
      id = bioguide ? "congress:" + bioguide : p.id;
    aliases[p.id] = id;
    directory.set(id, { ...p, id, bioguide });
  }
  const covered = new Set(history.documents || []);
  const archived = (history.rows || []).map((r) => {
    const memberId = "congress:" + r.bioguide;
    aliases[memberId] = memberId;
    return Object.assign(r, {
      memberId,
      member: congress[r.bioguide]?.name || r.member,
      ...congressIdentity(r.bioguide, r.filed),
    });
  });
  const rows = [
    ...archived,
    ...live.rows
      .filter((r) => !covered.has(officialDocument(r.url)))
      .map((r) => ({
        ...r,
        memberId: aliases[r.memberId] || r.memberId,
        provider: "live",
      })),
  ].sort(
    (a, b) =>
      b.filed.localeCompare(a.filed) ||
      b.traded.localeCompare(a.traded) ||
      a.id.localeCompare(b.id),
  );
  const people = politicalPeople([], rows),
    ids = new Set(people.map((p) => p.id));
  for (const [id, p] of directory)
    if (!ids.has(id)) people.push({ ...p, count: 0, buys: 0, sells: 0 });
  for (const p of people) {
    const old = directory.get(p.id),
      bioguide = p.id.match(/^congress:([A-Z]\d{6})$/)?.[1],
      meta = congress[bioguide],
      last = meta?.terms.at(-1);
    Object.assign(p, {
      bioguide: bioguide || null,
      name: meta?.name || old?.name || p.name,
      office: old?.office || p.office,
      chamber: last ? (last.type === "sen" ? "senate" : "house") : p.chamber,
      portrait:
        portraits[p.id]?.path ||
        portraits[bioguide]?.path ||
        old?.portrait ||
        p.portrait,
    });
  }
  const persons = new Map(people.map((p) => [p.id, p]));
  for (const r of rows) {
    const person = persons.get(r.memberId);
    r.portrait = person?.portrait || r.portrait;
    r.member = person?.name || r.member;
  }
  return {
    rows,
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    aliases,
    coverage: rows.length
      ? {
          from: rows.at(-1).filed,
          through: rows[0].filed,
          rows: rows.length,
          people: people.length,
        }
      : null,
  };
}
export function createPoliticalIntelligence(options) {
  const live = createPoliticalFeed(options),
    history = createPoliticalHistory(options);
  let cached = null,
    key = null;
  async function get(params) {
    const current = await live.get(params);
    const archive = history.get();
    const version = [
      current.version || "empty",
      archive.revision || "pending",
    ].join(":");
    if (key !== version) {
      cached = mergePoliticalSources(current, archive);
      key = version;
    }
    return {
      ...current,
      ...cached,
      version,
      status:
        current.status === "unavailable" && archive.rows?.length
          ? "cached"
          : current.status,
      refreshing: current.refreshing || archive.refreshing,
      sources: [
        {
          id: "live",
          name: "Kadoa",
          status: current.status,
          checkedAt: current.checkedAt,
          publishedAt: current.publishedAt,
          url: "https://github.com/kadoa-org/congress-trading-monitor",
        },
        {
          id: "history",
          name: "NexusTrade archive",
          status: archive.status,
          checkedAt: archive.checkedAt,
          publishedAt: archive.publishedAt,
          url: HISTORY_SOURCE,
        },
      ],
      historyStatus: archive.status,
    };
  }
  return {
    get,
    start() {
      live.start();
      history.start();
    },
    async stop() {
      await Promise.all([live.stop(), history.stop()]);
    },
    async evidence(asset) {
      const d = await get();
      if (!d.coverage) throw Error("Disclosure feed unavailable");
      return d.rows
        .filter((r) => r.ticker === asset.symbol)
        .slice(0, 8)
        .map((r) => ({
          kind: "filing",
          title: `${r.member} · ${r.type} · ${r.ticker}`,
          url: r.url,
          published_at: Date.parse(r.availableAt || r.filed),
          content: JSON.stringify({
            ...r,
            source:
              r.provider === "history"
                ? "NexusTrade / official disclosure"
                : "Kadoa / official disclosure",
            note: "Reported USD value bands, not exact execution prices or profit. Disclosures can include spouses and dependents. Coverage is partial; absence does not establish no trading.",
          }),
        }));
    },
  };
}
