// A small deterministic kernel for the platform preview and future event worker.
// Observations carry both occurrence and knowledge time to prevent hindsight leaks.
export function evaluateBranch(branch, observations, asOf) {
  const eligible = observations.filter(
    (o) =>
      o.asset === branch.asset &&
      o.verified === true &&
      Number.isFinite(o.occurredAt) &&
      Number.isFinite(o.recordedAt) &&
      o.occurredAt <= asOf &&
      o.recordedAt <= asOf &&
      o.occurredAt >= branch.publishedAt,
  );
  const events = eligible
    .filter((o) => o.kind === "event" && o.occurredAt <= branch.deadline)
    .sort((a, b) => a.occurredAt - b.occurredAt);
  const invalidation = events.find((o) =>
    branch.invalidatedBy?.includes(o.key),
  );
  const matches = branch.requires.map((key) =>
    events.find((o) => o.key === key),
  );
  const triggered = matches.every(Boolean);
  const triggerTime = triggered
    ? Math.max(branch.publishedAt, ...matches.map((o) => o.occurredAt))
    : Infinity;
  const hit = eligible
    .filter(
      (o) =>
        o.kind === "price" &&
        o.currency === branch.currency &&
        Number.isFinite(o.value) &&
        o.occurredAt >= triggerTime &&
        o.occurredAt <= branch.deadline &&
        (!invalidation || o.occurredAt < invalidation.occurredAt) &&
        o.value >= branch.target[0] &&
        o.value <= branch.target[1],
    )
    .sort((a, b) => a.occurredAt - b.occurredAt)[0];
  // A later invalidation does not erase an outcome that was already observed.
  return {
    status: hit
      ? "observed"
      : invalidation
        ? "invalidated"
        : asOf > branch.deadline
          ? "review"
          : triggered
            ? "triggered"
            : "watching",
    evidence: [
      ...matches.filter(Boolean).map((o) => o.id),
      ...(hit ? [hit.id] : []),
      ...(invalidation ? [invalidation.id] : []),
    ],
    outcome: !!hit,
    invalidatedAfterOutcome: !!(hit && invalidation),
  };
}

export function validateScenarioGraph(graph) {
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length > 500 ||
    !Array.isArray(graph.edges) ||
    graph.edges.length > 2000
  )
    throw Error("Invalid scenario graph.");
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (
    ids.size !== graph.nodes.length ||
    [...ids].some((id) => typeof id !== "string" || !id || id.length > 100)
  )
    throw Error("Invalid scenario identity.");
  const children = new Map([...ids].map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to))
      throw Error("Unknown scenario reference.");
    children.get(edge.from).push(edge.to);
  }
  const active = new Set(),
    complete = new Set();
  function visit(id) {
    if (active.has(id)) throw Error("Scenario graphs cannot contain cycles.");
    if (complete.has(id)) return;
    active.add(id);
    children.get(id).forEach(visit);
    active.delete(id);
    complete.add(id);
  }
  ids.forEach(visit);
  return graph;
}
