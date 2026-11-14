export const historyRanges = {
  "1d": { label: "1D", interval: "5m" },
  "1wk": { label: "1W", interval: "15m" },
  "1mo": { label: "1M", interval: "1d" },
  "3mo": { label: "3M", interval: "1d" },
  "1y": { label: "1Y", interval: "1d" },
  "5y": { label: "5Y", interval: "1wk" },
};

export function validateHistoryInput(symbol, range = "1mo") {
  if (
    typeof symbol !== "string" ||
    typeof range !== "string" ||
    !/^[A-Za-z0-9.^=-]{1,32}$/.test(symbol) ||
    !Object.hasOwn(historyRanges, range)
  )
    throw Object.assign(Error("Invalid asset or chart range."), {
      statusCode: 400,
    });
}
