import { resultSchema } from "./contract.js";
import { MAX_OUTPUT, models } from "./catalog.js";
// Errors intentionally contain no upstream body, request headers or prompt.
export class ProviderError extends Error {
  constructor(message, uncertain = true) {
    super(message);
    this.name = "ProviderError";
    this.uncertain = uncertain;
  }
}
async function boundedJSON(response) {
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw Error("Response limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
const count = (n) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000000)
    throw new ProviderError("Provider did not return valid usage.");
  return n;
};
export function geminiUsage(u) {
  if (!u) throw new ProviderError("Provider did not return usage.");
  const prompt = count(u.promptTokenCount),
    cached = count(u.cachedContentTokenCount ?? 0),
    output = count(u.candidatesTokenCount ?? 0),
    reasoning = count(u.thoughtsTokenCount ?? 0),
    tool = count(u.toolUsePromptTokenCount ?? 0);
  if (
    cached > prompt ||
    tool > 0 ||
    count(u.totalTokenCount) !== prompt + output + reasoning + tool
  )
    throw new ProviderError("Unrecognized provider token accounting.");
  return {
    input: prompt - cached,
    cached,
    output: output + reasoning,
    reasoning,
    write5m: 0,
    write1h: 0,
  };
}
export function claudeUsage(u) {
  if (!u) throw new ProviderError("Provider did not return usage.");
  const created = count(u.cache_creation_input_tokens ?? 0),
    write1h = count(u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
    write5m = count(
      u.cache_creation?.ephemeral_5m_input_tokens ?? created - write1h,
    );
  if (
    created !== write5m + write1h ||
    (u.server_tool_use && Object.values(u.server_tool_use).some((v) => v !== 0))
  )
    throw new ProviderError("Unrecognized provider tool or cache charges.");
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cached: count(u.cache_read_input_tokens ?? 0),
    write5m,
    write1h,
    reasoning: count(u.output_tokens_details?.thinking_tokens ?? 0),
  };
}
export function createProviders({ fetcher = fetch } = {}) {
  return async function generate({ provider, model, key, prompt, signal }) {
    if (!models.some((m) => m.id === model && m.provider === provider))
      throw new ProviderError("Unsupported model or provider.", false);
    let response;
    const gemini = provider === "gemini";
    const url = gemini
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : "https://api.anthropic.com/v1/messages";
    const body = gemini
      ? {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: MAX_OUTPUT,
            responseMimeType: "application/json",
            responseJsonSchema: resultSchema,
          },
        }
      : {
          model,
          max_tokens: MAX_OUTPUT,
          messages: [{ role: "user", content: prompt }],
          output_config: {
            format: { type: "json_schema", schema: resultSchema },
          },
        };
    try {
      response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(gemini
            ? { "x-goog-api-key": key }
            : {
                Authorization: "Bearer " + key,
                "anthropic-version": "2026-10-21",
              }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          signal || new AbortController().signal,
          AbortSignal.timeout(90000),
        ]),
      });
    } catch {
      throw new ProviderError(
        "Provider connection ended without confirmed usage. Check your provider account before reconciling.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const rejected = [400, 401, 403, 404, 413, 422, 429].includes(
        response.status,
      );
      throw new ProviderError(
        response.status === 401 || response.status === 403
          ? "Provider rejected this key or model access."
          : response.status === 429
            ? "Provider rate limit or quota reached."
            : `Provider request failed (HTTP ${response.status}).`,
        !rejected,
      );
    }
    let data;
    try {
      data = await boundedJSON(response);
    } catch {
      throw new ProviderError(
        "Provider response was incomplete; usage is unconfirmed.",
      );
    }
    const usage = gemini
      ? geminiUsage(data.usageMetadata)
      : claudeUsage(data.usage);
    return {
      usage,
      reportedUsage: gemini ? data.usageMetadata : data.usage,
      text: gemini
        ? (data.candidates?.[0]?.content?.parts || [])
            .filter((p) => !p.thought)
            .map((p) => p.text || "")
            .join("")
        : (data.content || [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(""),
      complete: gemini
        ? data.candidates?.[0]?.finishReason === "STOP"
        : data.stop_reason === "end_turn",
      requestId: String(
        gemini
          ? data.responseId || ""
          : response.headers.get("request-id") || data.id || "",
      ).slice(0, 200),
      responseModel: String(data.modelVersion || data.model || model).slice(
        0,
        160,
      ),
    };
  };
}
