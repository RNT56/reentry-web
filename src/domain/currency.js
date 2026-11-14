export function currencyUnit(currency) {
  return (
    {
      GBp: ["GBP", 0.01],
      GBX: ["GBP", 0.01],
      ILA: ["ILS", 0.01],
      ZAc: ["ZAR", 0.01],
    }[currency] || [currency, 1]
  );
}
