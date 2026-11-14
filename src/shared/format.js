export const $ = (s) => document.querySelector(s),
  money = (n) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 8 : 2,
    }).format(n),
  number = (n) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: 8 }).format(n),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  uid = () => crypto.randomUUID(),
  today = () => new Date().toLocaleDateString("en-CA");
