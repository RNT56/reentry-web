export async function request(
  path,
  method = "GET",
  body,
  { timeout = 20000, signal } = {},
) {
  const deadline = AbortSignal.timeout(timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Reentry-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (error) {
    if (error.name === "TimeoutError")
      throw Error(
        "Connection timed out. Your changes remain here; retry to save.",
        { cause: error },
      );
    throw error;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("The server is unavailable. Please try again.");
  }
  if (!res.ok)
    throw Object.assign(Error(data.error || "Request failed."), {
      status: res.status,
    });
  return data;
}
