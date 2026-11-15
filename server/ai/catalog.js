// USD per million tokens. Confirmed against linked provider documentation, 2026-11-14.
// No web-search tools, batch mode, paid caches or provider auto-routing are requested.
export const PRICING_VERSION = "2026-11-14";
const expires = Date.parse("2027-02-12T00:00:00Z");
const legacyModels = [
  {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    label: "Gemini 3.5 Flash Lite",
    input: 0.3,
    output: 2.5,
    cached: 0.03,
    source: "https://aistudio.google.com/docs/pricing",
  },
  {
    id: "gemini-3.8-flash",
    provider: "gemini",
    label: "Gemini 3.8 Flash",
    input: 0.75,
    output: 3.75,
    cached: 0.075,
    source: "https://aistudio.google.com/docs/pricing",
  },
  {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    label: "Claude Haiku 5.5",
    input: 0.1,
    output: 0.5,
    cached: 0.01,
    write5m: 0.125,
    write1h: 0.2,
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    label: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    cached: 0.1,
    write5m: 2.5,
    write1h: 4,
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
];
const google = "https://aistudio.google.com/docs/pricing";
const claude = "https://platform.claude.com/docs/en/about-claude/pricing";
export const imageModels = Object.freeze([
  {
    id: "gemini-3.1-flash-image",
    provider: "gemini",
    label: "Nano Banana 2",
    input: 0.5,
    output: 3,
    imageOutput: 60,
    cached: 0,
    maxOutput: 4096,
    source: google,
  },
  {
    id: "gemini-3.1-flash-lite-image",
    provider: "gemini",
    label: "Nano Banana 2 Lite",
    input: 0.25,
    output: 1.5,
    imageOutput: 30,
    cached: 0,
    maxOutput: 4096,
    source: google,
  },
]);
export const defaultModels = Object.freeze({
  gemini: "gemini-4-hydrogen",
  anthropic: "claude-sonnet-5-5",
});
export const models = Object.freeze([
  {
    id: defaultModels.gemini,
    provider: "gemini",
    label: "Hydrogen",
    input: 1.5,
    output: 7.5,
    cached: 0.075,
    source: google,
  },
  {
    id: "gemini-4-argon",
    provider: "gemini",
    label: "Argon",
    input: 2,
    output: 10,
    cached: 0.1,
    source: google,
  },
  {
    id: "gemini-4-carbon",
    provider: "gemini",
    label: "Carbon",
    input: 2,
    output: 10,
    cached: 0.1,
    source: google,
  },
  {
    ...legacyModels.find((m) => m.id === defaultModels.anthropic),
    label: "Sonnet 5.5",
  },
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    label: "Opus 5.5",
    input: 4,
    output: 20,
    cached: 0.2,
    write5m: 5,
    write1h: 8,
    source: claude,
  },
  {
    id: "claude-fable-5-2",
    provider: "anthropic",
    label: "Fable 5.2",
    input: 8,
    output: 40,
    cached: 0.2,
    write5m: 10,
    write1h: 16,
    source: claude,
  },
  {
    ...legacyModels.find((m) => m.id === "claude-haiku-5-5"),
    label: "Haiku 5.5",
  },
]);
export function effectiveModel(provider, model) {
  return models.some((m) => m.id === model && m.provider === provider)
    ? model
    : defaultModels[provider] || defaultModels.gemini;
}
export function priceFor(model, now = Date.now(), inputTokens = 0) {
  const base = [...models, ...legacyModels, ...imageModels].find(
    (m) => m.id === model,
  );
  if (!base || now >= expires)
    throw Error(
      "Model pricing needs an operator update before new AI requests.",
    );
  const price = { ...base, version: PRICING_VERSION, expires };
  if (
    ["gemini-4-carbon", "gemini-4-argon"].includes(model) &&
    now >= Date.parse("2026-12-01T00:00:00Z")
  )
    Object.assign(price, { input: 4, output: 20, cached: 0.2 });
  if (
    model === "gemini-3.8-flash" &&
    now >= Date.parse("2027-01-01T00:00:00Z")
  ) {
    price.input = 1.5;
    price.output = 7.5;
    price.cached = 0.15;
  }
  if (model === "claude-haiku-5-5" && inputTokens > 100000)
    Object.assign(price, {
      input: 0.5,
      output: 2.5,
      cached: 0.05,
      write5m: 0.625,
      write1h: 1,
    });
  return price;
}
export function costFor(usage, price) {
  for (const n of Object.values(usage))
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000000)
      throw Error("Invalid provider usage.");
  // $/M tokens equals microdollars/token. Output includes reasoning tokens.
  return Math.ceil(
    usage.input * price.input +
      usage.output * price.output +
      usage.cached * price.cached +
      usage.write5m * (price.write5m || 0) +
      usage.write1h * (price.write1h || 0) +
      (usage.imageOutput || 0) * (price.imageOutput || 0),
  );
}
export const MAX_OUTPUT = 8192;
export const MAX_INPUT = 75000;
export function reservationFor(prompt, price) {
  const inputBound = Buffer.byteLength(prompt, "utf8") + 12000;
  if (inputBound > MAX_INPUT)
    throw Error("Research input exceeds the safe context budget.");
  return Math.ceil(
    inputBound * price.input +
      (price.maxOutput || MAX_OUTPUT) *
        Math.max(price.output, price.imageOutput || 0),
  );
}
