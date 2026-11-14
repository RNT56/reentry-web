import { esc } from "../../shared/format.js";
import { icon, monogram, bindLogos } from "../../shared/ui.js";
import { evaluateBranch } from "../../domain/scenarios.js";
import { exampleAsset, chapters, branches, observations } from "./example.js";
const statuses = {
  watching: "Watching",
  triggered: "Condition met",
  observed: "Range observed",
  invalidated: "Invalidated",
  review: "Needs review",
};
export function exploreView() {
  return `<section class="explore-page" id="explore"><div class="explore-heading"><div><span class="eyebrow">THE NEXT CHAPTER OF REENTRY</span><h1>Ideas become<br><em>observable.</em></h1><p>Your research. Your scenarios. Reality, alongside.</p></div><div class="preview-stamp"><i></i> Interactive platform preview<span>Fictional Intel example · no live research</span></div></div><div class="explore-tabs" role="group" aria-label="Platform preview views">${[
    ["scenarios", "Scenario map"],
    ["research", "Research lens"],
    ["journal", "Journal"],
  ]
    .map(
      ([id, label]) =>
        `<button data-explore-view="${id}" aria-pressed="${id === "scenarios"}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div id="explore-content"></div><div class="platform-flow"><span>01 <b>Research</b></span>${icon("arrow")}<span>02 <b>Publish a thesis</b></span>${icon("arrow")}<span>03 <b>Map scenarios</b></span>${icon("arrow")}<span>04 <b>Observe & revise</b></span></div></section>`;
}
export function mountExplore(root) {
  let view = "scenarios",
    chapter = 2,
    selected = "downside";
  const stageTime = () => [0, 10, 20, 30][chapter];
  const result = (b) => evaluateBranch(b, observations, stageTime());
  const assetBar = () =>
    `<div class="explore-asset"><div class="row">${monogram(exampleAsset)}<div><h2>Intel</h2><span class="small">INTC · NASDAQ · USD</span></div></div><span class="concept-tag">Illustrative thesis</span></div>`;
  function curve() {
    const historic = [
      "M20 110L92 92L162 106L230 78",
      "M20 110L92 92L162 106L230 78L300 135L365 155",
      "M20 110L92 92L162 106L230 78L300 135L365 155L435 183L500 166",
      "M20 110L92 92L162 106L230 78L300 135L365 155L435 183L500 166L550 150",
    ][chapter];
    return `<div class="scenario-landscape"><div class="landscape-labels"><span>PRICE × POSSIBILITY</span><span>Conditional ranges · not probabilities</span></div><svg viewBox="0 0 900 235" role="img" aria-label="Illustrative price path alongside conditional downside 18 to 22 dollars, base 26 to 30 dollars and upside 38 to 44 dollars scenarios"><defs><linearGradient id="future-fade"><stop stop-color="#b9f68b" stop-opacity=".02"/><stop offset="1" stop-color="#b9f68b" stop-opacity=".14"/></linearGradient></defs><path d="M20 40H880M20 110H880M20 180H880" stroke="#ffffff0a"/><path d="M550 150L820 25V200Z" fill="url(#future-fade)"/><path d="M550 150Q650 80 790 32M550 150Q650 126 790 120M550 150Q650 186 790 190" fill="none" stroke="#6f8270" stroke-dasharray="4 6"/><path d="${historic}" fill="none" stroke="#d3e8c5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="550" y1="15" x2="550" y2="215" stroke="#ffffff20" stroke-dasharray="3 6"/><g font-size="12" font-family="inherit"><text x="807" y="36" fill="#b9f68b">$38–44</text><text x="807" y="124" fill="#a8c7fa">$26–30</text><text x="807" y="194" fill="#efad9d">$18–22</text><text x="20" y="230" fill="#869388">THESIS</text><text x="550" y="230" text-anchor="middle" fill="#869388">REPLAY WINDOW</text><text x="880" y="230" text-anchor="end" fill="#869388">POSSIBLE FUTURES</text></g>${chapter >= 1 ? '<circle cx="300" cy="135" r="5" fill="#efad9d"/>' : ""}${chapter >= 2 ? '<circle cx="435" cy="183" r="5" fill="#b9f68b"/>' : ""}</svg></div>`;
  }
  function branchCards() {
    return `<div class="scenario-root"><span class="root-dot"></span><span>Original thesis</span><b>What would have to be true?</b></div><div class="scenario-branches">${branches
      .map((b) => {
        const future = b.publishedAt > stageTime(),
          r = result(b);
        return `<button class="scenario-node ${b.tone} ${selected === b.id ? "selected" : ""} ${future ? "future-node" : ""}" data-branch="${b.id}" aria-pressed="${selected === b.id}"><span class="node-status"><i></i>${future ? "Future revision" : statuses[r.status]}</span><h3>${b.title}</h3><div class="node-range">$${b.target[0]}<span>–</span>${b.target[1]}</div><p>${b.condition}</p><span class="node-footer">${b.horizon}${icon("arrow")}</span></button>`;
      })
      .join("")}</div>`;
  }
  function evidencePanel() {
    const b = branches.find((b) => b.id === selected),
      r = result(b);
    return `<div class="scenario-evidence"><div><span class="eyebrow">LINKED ARTICLE → ${b.id === "upside" ? "REVISION 02" : "REVISION 01"}</span><h3>${b.article}</h3><blockquote>“${esc(b.excerpt)}”</blockquote><button class="link" data-open-journal>Open journal preview ↗</button></div><div class="evidence-ledger"><span class="eyebrow">EVIDENCE TRAIL</span><div><span class="evidence-dot ${r.evidence.includes("event-1") ? "matched" : ""}"></span><span>Condition verified<small>${r.evidence.includes("event-1") ? "Illustrative company update · day 10" : "Waiting for matching evidence"}</small></span></div><div><span class="evidence-dot ${r.outcome ? "matched" : ""}"></span><span>Price range observed<small>${r.outcome ? "$21 in $18–22 · day 20" : "No qualifying observation in replay"}</small></span></div><p class="small">A price touch is evidence of price, not proof of the cause.</p></div></div>`;
  }
  function scenarios() {
    return `<div class="vision-panel">${assetBar()}${curve()}<div class="replay-control"><div><span class="eyebrow">REPLAY THE THESIS</span><strong>${chapters[chapter]}</strong></div><div class="replay-steps" role="group" aria-label="Scenario replay">${chapters.map((label, i) => `<button data-chapter="${i}" aria-label="${label}" aria-pressed="${i === chapter}" title="${label}">${String(i + 1).padStart(2, "0")}</button>`).join("")}</div></div>${branchCards()}${evidencePanel()}</div>`;
  }
  function research() {
    return `<div class="vision-panel">${assetBar()}<div class="research-grid"><div class="research-radar"><span class="eyebrow">EVIDENCE, NOT A MAGIC SCORE</span><svg viewBox="0 0 360 320" role="img" aria-label="Illustrative research radar comparing valuation, execution, sentiment, catalysts and financial strength"><g fill="none" stroke="#ffffff12"><path d="M180 40 304 130 257 275 103 275 56 130Z"/><path d="M180 80 266 143 233 245 127 245 94 143Z"/><path d="M180 120 228 156 210 215 150 215 132 156Z"/><path d="M180 180V40M180 180 304 130M180 180 257 275M180 180 103 275M180 180 56 130"/></g><path d="M180 87 279 140 221 232 119 254 126 157Z" fill="#b9f68b1b" stroke="#b9f68b" stroke-width="2"/><g fill="#aab7ac" font-size="11" text-anchor="middle"><text x="180" y="23">Valuation</text><text x="315" y="116">Catalysts</text><text x="270" y="300">Sentiment</text><text x="89" y="300">Financials</text><text x="45" y="116">Execution</text></g></svg><span class="small">Illustrative dimensions · no computed investment score</span></div><div class="research-signals"><span class="eyebrow">THE RESEARCH STACK</span><h2>See what changed.<br><em>Then see why.</em></h2>${[
      [
        "01",
        "Source-backed briefs",
        "Every material claim links to its source and date.",
      ],
      [
        "02",
        "Sentiment with context",
        "Separate news, filings and social conversation. Show coverage and disagreement.",
      ],
      [
        "03",
        "Catalysts, on the chart",
        "Earnings, launches and thesis conditions on one timeline.",
      ],
      [
        "04",
        "Human-approved scenarios",
        "AI proposes structured conditions. You review before publication.",
      ],
    ]
      .map(
        ([n, t, d]) =>
          `<div class="research-signal"><span>${n}</span><div><b>${t}</b><p>${d}</p></div></div>`,
      )
      .join(
        "",
      )}<button class="secondary" data-open-scenarios>Connect to the scenario map ↗</button></div></div></div>`;
  }
  function journal() {
    const b = branches.find((b) => b.id === selected);
    return `<div class="journal-layout"><aside class="journal-list"><span class="eyebrow">THE PUBLIC JOURNAL · CONCEPT</span><h2>Thinking,<br>in the open.</h2>${branches.map((b, i) => `<button data-article="${b.id}" class="journal-entry ${selected === b.id ? "selected" : ""}"><span>INTC <i>THESIS ${String(i + 1).padStart(2, "0")}</i></span><h3>${b.article}</h3><small>${b.id === "upside" ? "Follow-up · adds a new branch" : "Original thesis · conditional range"} ↗</small></button>`).join("")}</aside><article class="vision-panel journal-reading"><div class="journal-byline"><span class="concept-tag">Example article</span><span>Public reading · private portfolios</span></div><div class="eyebrow">INTEL / ${b.rationale.toUpperCase()}</div><h2>${b.article}.</h2><p class="journal-deck">A short thesis. A visible condition.<br>An outcome we can revisit.</p><blockquote>${esc(b.excerpt)}</blockquote><div class="article-mapping"><span class="eyebrow">THIS PASSAGE BECOMES A BRANCH</span><div><span>IF</span><b>${b.short}</b></div><div><span>THEN</span><b>$${b.target[0]}–${b.target[1]} · ${b.currency}</b></div><div><span>WHEN</span><b>${b.horizon}</b></div></div><button class="primary" data-open-scenarios>See it in the scenario map ${icon("arrow")}</button><p class="small">Published versions stay intact. Follow-ups add dated revisions; the original prediction remains visible.</p></article></div>`;
  }
  function render() {
    root
      .querySelectorAll("[data-explore-view]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.exploreView === view)),
      );
    root.querySelector("#explore-content").innerHTML =
      view === "research"
        ? research()
        : view === "journal"
          ? journal()
          : scenarios();
    bindLogos();
  }
  root.onclick = (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    const previousView = view;
    if (button.dataset.exploreView) view = button.dataset.exploreView;
    else if (button.dataset.chapter) chapter = Number(button.dataset.chapter);
    else if (button.dataset.branch) selected = button.dataset.branch;
    else if (button.dataset.article) selected = button.dataset.article;
    else if (button.hasAttribute("data-open-journal")) view = "journal";
    else if (button.hasAttribute("data-open-scenarios")) {
      view = "scenarios";
      if (selected === "upside") chapter = 3;
    } else return;
    const focusAttribute = [...button.attributes].find((a) =>
      a.name.startsWith("data-"),
    );
    render();
    if (previousView !== view)
      root.querySelector(".explore-tabs").scrollIntoView({ block: "start" });
    if (focusAttribute)
      root
        .querySelector(`[${focusAttribute.name}="${focusAttribute.value}"]`)
        ?.focus({ preventScroll: true });
  };
  render();
}
