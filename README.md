# Reentry

Private stock portfolio and after-tax buyback planner. No dependencies, broker login or trading permissions.

## Run

- `npm run dev` — http://localhost:4173
- `npm test` — calculation tests
- `npm run build` — bundle browser assets into the Cloudflare Worker
- `npm run validate` — validate the deployment artifact

## Features

Manual purchases grouped by stock and depot, FIFO with purchase/sale fees, partial sales, 0/5/10/custom share growth targets, fractional/whole shares, German tax presets, manual loss and allowance offsets, recorded sales with actual withholding, completed buybacks, browser-local persistence and validated JSON export/import. Yahoo stock search and quote proxy caches responses for 60 seconds; visible portfolio refreshes every five minutes. Only EUR quotes auto-populate estimates. Non-EUR/unavailable quotes use explicit manual EUR input.

## Data and assumptions

Financial records remain in localStorage on each browser/device. Export backups before clearing browser data. No cross-device sync. Server receives stock search terms and symbols only. Yahoo is an unofficial personal-use source and may throttle or be unavailable; failures are shown with manual fallback. Quotes are indicative, may be delayed and may differ from broker bid/ask execution prices. Verify actual fees/tax when recording transactions.

Ordinary post-2008 shares only. No automatic corporate actions, ETF tax treatment, tax refunds, or broker statement reconciliation. Purchase entries can be corrected for splits. Loss/allowance inputs are per-scenario; they are not automatically reconciled across accounts. Recorded trades do not execute orders. Tests use illustrative data.

## Structure

`src/engine.js`: pure calculation engine. `src/app.js`: browser application. `src/server.js`: bounded market-data API. `scripts/bundle.mjs`: embeds assets in `worker/index.js`. The Worker is deployed privately through Sites.
