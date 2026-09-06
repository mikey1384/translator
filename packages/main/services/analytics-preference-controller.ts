export type AnalyticsChoice = { enabled: boolean; revision: number };
export type AnalyticsPrivacyState = AnalyticsChoice & {
  status: 'ready' | 'saving' | 'pending';
};

// Persistence and transport are injected so offline changes and overlapping
// responses can be tested without Electron or real analytics traffic.
export function createAnalyticsPreferenceController(deps: {
  read(): AnalyticsChoice;
  write(choice: AnalyticsChoice): void;
  send(choice: AnalyticsChoice): Promise<AnalyticsChoice>;
  clearPending(): void;
  changed(state: AnalyticsPrivacyState): void;
  available(): boolean;
}) {
  const saved = deps.read();
  let state: AnalyticsPrivacyState = {
    enabled: saved.enabled === true,
    revision:
      Number.isSafeInteger(saved.revision) && saved.revision >= 0
        ? saved.revision
        : 0,
    status: 'pending',
  };
  let largestRevision = state.revision;
  let active = new AbortController();
  let chain: Promise<unknown> = Promise.resolve();
  const snapshot = (): AnalyticsPrivacyState => ({ ...state });
  function notify() {
    deps.changed(snapshot());
  }

  async function sync() {
    const choice = { enabled: state.enabled, revision: state.revision };
    state.status = 'saving';
    notify();
    const run = chain.then(async () => {
      // Superseded locally before transport starts: skip this stale choice.
      if (state.revision !== choice.revision) return;
      try {
        if (!deps.available()) throw new Error('unavailable');
        const canonical = await deps.send(choice);
        if (
          typeof canonical.enabled !== 'boolean' ||
          !Number.isSafeInteger(canonical.revision)
        )
          throw new Error('invalid preference response');
        largestRevision = Math.max(largestRevision, canonical.revision);
        if (state.revision !== choice.revision) return;
        state.status =
          canonical.revision === choice.revision &&
          canonical.enabled === choice.enabled
            ? 'ready'
            : 'pending';
      } catch {
        if (state.revision === choice.revision) state.status = 'pending';
      }
      notify();
    });
    chain = run.catch(() => {});
    await run;
    return snapshot();
  }

  function setEnabled(enabled: boolean) {
    if (typeof enabled !== 'boolean')
      throw new Error('Invalid analytics choice');
    const choice = {
      enabled,
      revision: Math.max(Date.now(), largestRevision + 1),
    };
    // Persist before acknowledging. If storage fails, the existing choice stands.
    deps.write(choice);
    largestRevision = choice.revision;
    active.abort();
    active = new AbortController();
    state = { ...choice, status: 'pending' };
    deps.clearPending();
    notify();
    return sync();
  }

  function maySend(revision = state.revision) {
    return (
      deps.available() &&
      state.enabled &&
      state.status === 'ready' &&
      revision === state.revision
    );
  }
  return { snapshot, sync, setEnabled, maySend, signal: () => active.signal };
}
