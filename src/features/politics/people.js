import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { modal, close, icon } from "../../shared/ui.js";

const portraits = {
  oge_donald_trump: "/people/donald-trump.jpg",
  oge_kevin_warsh: "/people/kevin-warsh.png",
  oge_scott_kupor: "/people/scott-kupor.jpg",
};
export const chamber = (v) =>
  ({ house: "House", senate: "Senate", executive: "Executive" })[v] || "";
export const party = (v) =>
  ({ D: "Democrat", R: "Republican", I: "Independent" })[v] || "";
export function avatar(p, large = false) {
  const name = p.name || p.member,
    portrait = p.portrait || portraits[p.memberId || p.id];
  return `<span class="political-avatar ${large ? "large" : ""}" aria-hidden="true"><span>${esc(
    name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join(""),
  )}</span>${portrait ? `<img src="${esc(portrait)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
}

export async function choosePolitician({ onSelect, isAlive = () => true }) {
  const { people } = await request("/api/politics/people");
  if (!isAlive()) return;
  modal(
    `<h2>People <span class="muted">${people.length}</span></h2><div class="politician-directory"><div class="politician-directory-search">${icon("sliders")}<input type="search" aria-label="Find a politician" placeholder="Name, state or chamber" autocomplete="off"></div><div class="politician-directory-rows"></div><span class="politician-directory-count" role="status"></span></div>`,
  );
  const dialog = document.querySelector("#modal"),
    list = dialog.querySelector(".politician-directory-rows"),
    search = dialog.querySelector("input");
  function draw() {
    const q = search.value.trim().toLowerCase();
    const matches = people.filter((p) =>
      [p.name, p.state, chamber(p.chamber), party(p.party)].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
    );
    list.innerHTML =
      matches
        .map(
          (p) =>
            `<button class="politician-directory-row" data-person-id="${esc(p.id)}">${avatar(p)}<span><strong>${esc(p.name)}</strong><small>${esc(chamber(p.chamber))}${p.state ? " · " + esc(p.state) : ""}${p.party ? " · " + esc(p.party) : ""}</small></span><span class="politician-directory-activity">${p.count ? `<b>${p.count.toLocaleString()}</b><small>in feed</small>` : "<small>Outside feed window</small>"}</span>${icon("arrow")}</button>`,
        )
        .join("") || '<div class="capitol-empty">No matching people</div>';
    dialog.querySelector(".politician-directory-count").textContent =
      `${matches.length} ${matches.length === 1 ? "person" : "people"}`;
    list.querySelectorAll("img").forEach((img) => {
      img.onerror = () => img.remove();
    });
    list.scrollTop = 0;
  }
  search.oninput = draw;
  list.onclick = (e) => {
    const button = e.target.closest("[data-person-id]");
    if (!button || !isAlive()) return;
    close();
    onSelect(button.dataset.personId);
  };
  draw();
}
