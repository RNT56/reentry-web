// Display choices only. Depot names never initiate a broker connection.
export const depots = Object.freeze(
  [
    { name: "Trade Republic", label: "Trade Republic" },
    { name: "Consorsbank", label: "Consorsbank" },
    { name: "ING", label: "ING" },
    { name: "comdirect", label: "comdirect" },
    { name: "DKB", label: "DKB" },
    { name: "Scalable Capital", label: "Scalable Capital" },
    { name: "flatex", label: "flatex" },
    { name: "Finanzen invest", label: "Finanzen invest (ZERO)" },
    { name: "SMARTBROKER+", label: "SMARTBROKER+" },
    { name: "S Broker", label: "S Broker" },
    { name: "Sparkasse", label: "Sparkasse" },
    { name: "Commerzbank", label: "Commerzbank" },
    { name: "maxblue", label: "maxblue · Deutsche Bank" },
    { name: "Interactive Brokers", label: "Interactive Brokers" },
    { name: "Other", label: "Other" },
  ].map(Object.freeze),
);

export function isDepotName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

// Imported or renamed depots remain selectable without rewriting historical records.
export function depotChoices(current) {
  return isDepotName(current) && !depots.some((depot) => depot.name === current)
    ? [{ name: current, label: current }, ...depots]
    : depots;
}
