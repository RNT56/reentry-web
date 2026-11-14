// Serial optimistic writes. A failed write retains the newest local snapshot.
// Conflicts/auth failures require explicit resolution; never retry by overwriting.
export function createSaveQueue({ write, onChange = () => {}, delay = 250 }) {
  let revision = 0,
    pending = null,
    active = null,
    timer,
    problem = null;
  const status = () => ({
    revision,
    pendingSave: !!pending,
    saving: !!active,
    saveProblem: problem,
  });
  const notify = () => onChange(status());
  const queue = {
    get status() {
      return status();
    },
    reset(nextRevision) {
      if (active) throw Error("A save is still in progress.");
      clearTimeout(timer);
      revision = nextRevision;
      pending = null;
      problem = null;
      notify();
    },
    enqueue(state) {
      pending = structuredClone(state);
      clearTimeout(timer);
      notify();
      if (![401, 409].includes(problem?.status))
        timer = setTimeout(() => queue.flush(), delay);
    },
    flush() {
      clearTimeout(timer);
      if (active) return active;
      if (!pending || [401, 409].includes(problem?.status))
        return Promise.resolve();
      active = Promise.resolve()
        .then(async () => {
          while (pending) {
            const next = pending;
            pending = null;
            try {
              const response = await write(next, revision);
              revision = response.revision;
              problem = null;
            } catch (error) {
              pending ||= next;
              problem = error;
              break;
            }
          }
        })
        .finally(() => {
          active = null;
          notify();
        });
      notify();
      return active;
    },
  };
  return queue;
}
