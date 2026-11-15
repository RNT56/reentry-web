import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { modal, close, icon, toast } from "../../shared/ui.js";

export function watchlistBar(lists, selected, symbol) {
  return `<div class="watchlist-bar"><label class="watchlist-switch"><span class="eyebrow">Watchlist</span><select data-watchlist-select aria-label="Research watchlist"><option value="all" ${!selected ? "selected" : ""}>All assets</option>${lists.map((l) => `<option value="${esc(l.id)}" ${l.id === selected ? "selected" : ""}>${esc(l.name)} · ${l.symbols.length}</option>`).join("")}</select></label><div class="watchlist-actions">${symbol ? `<button class="link" data-watchlist-assign title="Add ${esc(symbol)} to a watchlist">${icon("bookmark")}<span>Add to list</span></button>` : ""}<button class="icon-button" data-watchlist-manage title="Manage watchlists" aria-label="Manage watchlists">${icon("sliders")}</button><button class="icon-button" data-watchlist-create title="New watchlist" aria-label="New watchlist">${icon("plus")}</button></div></div>`;
}

export async function editWatchlists({
  selectedId = null,
  create = false,
  onChange = () => {},
  ownerId,
} = {}) {
  let state = await request("/api/watchlists");
  function draw(editId = null) {
    const item = state.lists.find((l) => l.id === editId);
    modal(
      `<h2>${item ? "Edit watchlist" : "Watchlists"}</h2><div class="watchlist-manager">${!editId ? state.lists.map((l) => `<button class="watchlist-row" data-edit-list="${esc(l.id)}"><span>${esc(l.name)}</span><small>${l.symbols.length} assets</small>${icon("arrow")}</button>`).join("") : ""}</div><form id="watchlist-form"><div class="field"><label for="watchlist-name">${item ? "Name" : "New watchlist"}</label><input id="watchlist-name" name="name" value="${esc(item?.name || "")}" placeholder="Semiconductors" required maxlength="40" autocomplete="off"></div><div class="actions">${item ? '<button type="button" class="link" data-delete-list>Delete list</button>' : ""}<button class="primary">${item ? "Update" : "Create list"}</button></div><p class="form-error" role="alert" hidden></p></form>`,
    );
    const dialog = document.querySelector("#modal");
    dialog
      .querySelectorAll("[data-edit-list]")
      .forEach((b) => (b.onclick = () => draw(b.dataset.editList)));
    const fail = (e) => {
      const n = dialog.querySelector(".form-error");
      n.hidden = false;
      n.textContent = e.message;
    };
    dialog.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.submitter;
      b.disabled = true;
      try {
        const result = await request(
          item ? "/api/watchlists/" + item.id : "/api/watchlists",
          item ? "PATCH" : "POST",
          {
            name: dialog.querySelector("input").value,
            ...(item ? { revision: item.revision } : {}),
          },
          { ownerId },
        );
        close();
        await onChange(item ? selectedId : result.id);
      } catch (error) {
        fail(error);
        b.disabled = false;
      }
    };
    const remove = dialog.querySelector("[data-delete-list]");
    if (remove)
      remove.onclick = async () => {
        if (remove.dataset.confirm !== "yes") {
          remove.dataset.confirm = "yes";
          remove.textContent = "Delete this list?";
          return;
        }
        remove.disabled = true;
        try {
          await request(
            "/api/watchlists/" + item.id,
            "DELETE",
            { revision: item.revision },
            { ownerId },
          );
          close();
          await onChange(item.id === selectedId ? null : selectedId);
        } catch (e) {
          fail(e);
          remove.disabled = false;
        }
      };
  }
  draw(create ? null : selectedId);
}

export async function chooseWatchlists(
  asset,
  { onChange = () => {}, ownerId } = {},
) {
  const state = await request("/api/watchlists");
  if (!state.lists.length)
    return editWatchlists({
      create: true,
      ownerId,
      onChange: async (id) => {
        await request(
          "/api/research/assets/" + encodeURIComponent(asset.symbol),
          "PUT",
          {
            name: asset.name || asset.symbol,
            automatic: false,
            intervalHours: 24,
            watchlistId: id,
          },
          { ownerId },
        );
        await onChange();
        toast(asset.symbol + " added to watchlist");
      },
    });
  modal(
    `<h2>${esc(asset.symbol)} <span class="muted">/ Watchlists</span></h2><div class="watchlist-manager">${state.lists.map((l) => `<button class="watchlist-row" data-list-id="${esc(l.id)}" aria-pressed="${l.symbols.includes(asset.symbol)}"><span>${esc(l.name)}</span><small>${l.symbols.length}</small><span class="watchlist-check">${icon(l.symbols.includes(asset.symbol) ? "check" : "plus")}</span></button>`).join("")}</div>`,
  );
  const dialog = document.querySelector("#modal");
  dialog.querySelectorAll("[data-list-id]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const add = b.getAttribute("aria-pressed") !== "true";
          if (add) {
            // Preserve existing research automation when assigning an already watched asset.
            const all = await request("/api/research/assets?list=all");
            const existing = all.assets.find((a) => a.symbol === asset.symbol);
            await request(
              "/api/research/assets/" + encodeURIComponent(asset.symbol),
              "PUT",
              {
                name: existing?.name || asset.name || asset.symbol,
                automatic: !!existing?.automatic,
                intervalHours: existing?.interval_hours || 24,
                watchlistId: b.dataset.listId,
              },
              { ownerId },
            );
          } else
            await request(
              "/api/watchlists/" +
                b.dataset.listId +
                "/assets/" +
                encodeURIComponent(asset.symbol),
              "DELETE",
              undefined,
              { ownerId },
            );
          b.setAttribute("aria-pressed", String(add));
          b.querySelector(".watchlist-check").innerHTML = icon(
            add ? "check" : "plus",
          );
          const count = b.querySelector("small");
          count.textContent = Number(count.textContent) + (add ? 1 : -1);
          await onChange();
        } catch (e) {
          toast(e.message);
        } finally {
          b.disabled = false;
        }
      }),
  );
}
