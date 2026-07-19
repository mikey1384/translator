// Keyed async mutex. Serializes read-modify-write sections on shared
// singleton files (library index.json files) that multiple tabs' IPC
// handlers can hit concurrently. Not reentrant: a locked function must
// never call another function that takes the same key.
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const result = prev.then(
    () => fn(),
    () => fn()
  );
  chains.set(
    key,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}
