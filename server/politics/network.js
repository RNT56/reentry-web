const HOSTS = new Set([
  "huggingface.co",
  "unitedstates.github.io",
  "mcp.optimistfi.com",
]);
function allowed(url) {
  const u = new URL(url);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (HOSTS.has(u.hostname) || u.hostname.endsWith(".hf.co"))
  );
}
export async function sourceBytes(
  fetcher,
  url,
  { limit = 24000000, signal, etag } = {},
) {
  for (let i = 0; i < 5; i++) {
    if (!allowed(url)) throw Error("Unapproved disclosure endpoint");
    const r = await fetcher(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Reentry public-disclosure research",
        ...(etag ? { "If-None-Match": etag } : {}),
      },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      await r.body?.cancel();
      url = new URL(r.headers.get("location"), url).href;
      continue;
    }
    if (r.status === 304) return { unchanged: true, etag };
    if (!r.ok) {
      await r.body?.cancel();
      const error = Error("Disclosure archive unavailable");
      const after = r.headers.get("retry-after");
      if (after)
        error.retryAfter = Number.isFinite(Number(after))
          ? Number(after) * 1000
          : Math.max(0, Date.parse(after) - Date.now());
      throw error;
    }
    const reader = r.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw Error("Disclosure download exceeds limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return { bytes: Buffer.concat(chunks), etag: r.headers.get("etag") };
  }
  throw Error("Too many disclosure redirects");
}
