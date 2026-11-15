/** Axis labels retain date context as an intraday view expands across sessions. */
export function chartTimeLabel(data, geometry, now = Date.now()) {
  const start = new Date(data.points[geometry.visibleFrom].time * 1000),
    end = new Date(data.points[geometry.visibleTo].time * 1000),
    timeZone = data.timeZone || "UTC",
    intraday = ["5m", "15m"].includes(data.interval),
    day = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }),
    multiDay = day.format(start) !== day.format(end),
    showYear =
      start.getUTCFullYear() !== new Date(now).getUTCFullYear() ||
      start.getUTCFullYear() !== end.getUTCFullYear();
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    ...(!intraday || multiDay ? { day: "numeric", month: "short" } : {}),
    ...(intraday ? { hour: "2-digit", minute: "2-digit" } : {}),
    ...(showYear ? { year: "2-digit" } : {}),
  });
  return (time) => format.format(time * 1000);
}
