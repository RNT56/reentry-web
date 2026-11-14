import { randomUUID } from "node:crypto";
export const id = () => randomUUID();
export const fail = (message, statusCode = 400) =>
  Object.assign(Error(message), { statusCode });
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function text(value, max = 200, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max ||
    value.includes(String.fromCharCode(0))
  )
    throw fail("Invalid text or length.");
  return value.trim();
}
export function symbol(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9.^=-]{1,32}$/.test(value))
    throw fail("Invalid asset symbol.");
  return value.toUpperCase();
}
export function safeURL(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      value.length > 2000
    )
      throw Error();
    return u.href;
  } catch {
    throw fail("Use an HTTPS source link.");
  }
}
export function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw fail("Value is outside the permitted range.");
  return value;
}
export function audit(db, user, action, details = {}) {
  db.prepare("INSERT INTO ai_audit VALUES(?,?,?,?,?)").run(
    id(),
    user,
    action,
    JSON.stringify(details),
    Date.now(),
  );
}
