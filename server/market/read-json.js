/** Bound upstream JSON before parsing, including chunked responses. */
export async function readMarketJSON(response, limit = 4 * 1024 * 1024) {
  const length = Number(response.headers?.get("content-length"));
  if (length > limit) {
    await response.body?.cancel();
    throw Error("Market response too large.");
  }
  // Test/provider adapters may supply decoded JSON without a Fetch stream.
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("Market response too large.");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
