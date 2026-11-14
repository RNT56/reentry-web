import test from "node:test";
import assert from "node:assert/strict";
import { depots, depotChoices, isDepotName } from "../src/domain/depots.js";
import {
  defaults,
  emptyPortfolio,
  taxPresets,
} from "../src/domain/portfolio.js";
import { validatePortfolio } from "../src/domain/portfolio-validation.js";
import { recordSale, recordBuyback } from "../src/domain/trades.js";

const holding = (broker) => ({
  id: "holding-1",
  symbol: "AAPL",
  name: "Apple",
  broker,
  lots: [{ id: "lot-1", qty: 10, price: 100, fee: 1, date: "2026-01-01" }],
});

test("new portfolios use the church-tax deductible German 9% combined rate", () => {
  const combined = ((1 + 0.09 + 0.055) / (4 + 0.09)) * 100;
  assert.ok(Math.abs(defaults.rate - combined) < 1e-6);
  assert.equal(emptyPortfolio().settings.rate, 27.99511);
  assert.equal(
    taxPresets.some((p) => p.rate === 27),
    false,
  );
  const state = emptyPortfolio();
  state.settings.rate = 27;
  assert.equal(validatePortfolio(state).settings.rate, 27);
});

test("every selectable depot survives sale and buyback recording", () => {
  assert.equal(new Set(depots.map((d) => d.name)).size, depots.length);
  assert.ok(depots.length >= 14);
  for (const { name } of depots) {
    const state = emptyPortfolio();
    state.holdings.push(holding(name));
    const sale = recordSale(state, {
      id: "sale-1",
      holdingId: "holding-1",
      quantity: 10,
      price: 120,
      sellFee: 1,
      buyFee: 1,
      tax: 55,
      targetGain: 5,
      date: "2026-02-01",
    });
    const bought = recordBuyback(sale, {
      saleId: "sale-1",
      quantity: 11,
      price: 100,
      fee: 1,
      holdingId: "holding-2",
      lotId: "lot-2",
      date: "2026-03-01",
    });
    assert.equal(bought.holdings[0].broker, name);
    assert.equal(bought.sales[0].broker, name);
  }
});

test("renamed and custom imported depot names stay intact with bounded validation", () => {
  for (const name of ["finanzen.net ZERO", "My existing depot"]) {
    const state = emptyPortfolio();
    state.holdings.push(holding(name));
    const before = structuredClone(state);
    assert.deepEqual(validatePortfolio(state), before);
    assert.equal(depotChoices(name)[0].name, name);
  }
  for (const name of ["", " ", " ING", "ING\n", "a".repeat(81), null, 42]) {
    assert.equal(isDepotName(name), false);
    const state = emptyPortfolio();
    state.holdings.push(holding(name));
    assert.throws(() => validatePortfolio(state), /Invalid portfolio/);
  }
});
