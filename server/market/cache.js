export function createRequestCache({
  ttl = 60000,
  limit = 500,
  maxPending = 32,
  now = Date.now,
} = {}) {
  const values = new Map(),
    pending = new Map();
  return async function cached(key, load) {
    const previous = values.get(key);
    if (previous && now() - previous.at < ttl) return previous.data;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= maxPending)
      throw Object.assign(Error("Market data is busy. Try again shortly."), {
        statusCode: 503,
      });
    const promise = Promise.resolve()
      .then(load)
      .then((data) => {
        values.delete(key);
        if (values.size >= limit) values.delete(values.keys().next().value);
        values.set(key, { data, at: now() });
        return data;
      })
      .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
