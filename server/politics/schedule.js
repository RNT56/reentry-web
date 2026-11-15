export const POLITICAL_CHECK_INTERVAL = 12 * 60 * 60 * 1000;

// Apply the cadence to existing healthy caches without a startup write or fetch.
// A failed request keeps its persisted retry/backoff schedule.
export function applyPoliticalCadence(sync) {
  if (sync.checked_at && !sync.failures)
    sync.next_check_at = Math.max(
      sync.next_check_at || 0,
      sync.checked_at + POLITICAL_CHECK_INTERVAL,
    );
}
