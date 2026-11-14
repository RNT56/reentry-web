const genericClientErrors = new Set([
  "Bad Request",
  "Unauthorized",
  "Forbidden",
  "Not Found",
  "Method Not Allowed",
  "Not Acceptable",
  "Request Timeout",
  "Conflict",
  "Gone",
  "Length Required",
  "Precondition Failed",
  "Payload Too Large",
  "URI Too Long",
  "Unsupported Media Type",
  "Range Not Satisfiable",
  "Expectation Failed",
  "Unprocessable Entity",
  "Unprocessable Content",
  "Too Many Requests",
]);
const unavailable = "The server is unavailable. Please try again.";

function errorMessage(status, data) {
  if (status >= 500) return unavailable;
  const error = typeof data?.error === "string" ? data.error.trim() : "";
  const message = typeof data?.message === "string" ? data.message.trim() : "";
  if (
    genericClientErrors.has(error) &&
    message &&
    !genericClientErrors.has(message)
  )
    return message;
  return error || "Request failed.";
}

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
    throw Error(unavailable);
  }
  if (!res.ok)
    throw Object.assign(Error(errorMessage(res.status, data)), {
      status: res.status,
    });
  return data;
}
