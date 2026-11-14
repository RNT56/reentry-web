# Provider catalog

Verified 14 November 2026 against first-party documentation. Default Gemini model: Hydrogen. Default Claude model: Sonnet 5.5. Gemini 3 models are excluded from selection and dispatch. Existing stored Gemini preferences resolve to Hydrogen at read time; startup does not rewrite existing account data or historical ledgers.

| API ID | Input / output / cached input, USD per million tokens |
|---|---|
| gemini-4-hydrogen | 1.50 / 7.50 / 0.075 |
| gemini-4-argon | 2 / 10 / 0.10 through November 30; 4 / 20 / 0.20 from December 1 |
| gemini-4-carbon | 2 / 10 / 0.10 through November 30; 4 / 20 / 0.20 from December 1 |
| claude-sonnet-5-5 | 2 / 10 / 0.10 |
| claude-opus-5-5 | 4 / 20 / 0.20 |
| claude-fable-5-2 | 8 / 40 / 0.20 |
| claude-haiku-5-5 | 0.10 / 0.50 / 0.01 up to 100K input; higher-context tier retained in catalog |

Claude cache writes are separately priced. Every request reserves its bounded input and output cost before dispatch. Expensive models may require a larger explicitly selected per-run cap. Gemini uses low thinking for compact structured briefs and an 8,192-token combined output ceiling. Provider usage includes billed reasoning. Actual paid provider calls require an account key and were not made during development.

Sources: [Google pricing](https://aistudio.google.com/docs/pricing), [Hydrogen API migration](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen), [Google model IDs](https://aistudio.google.com/docs/models), [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Claude model overview](https://platform.claude.com/docs/en/models/overview).
