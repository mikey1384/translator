export type StoredApiKeySummary = { present: boolean; last4: string | null };

/** What the renderer may know about a saved key: that it exists, and its tail. */
export function summarizeStoredApiKey(
  key: string | null | undefined
): StoredApiKeySummary {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { present: false, last4: null };
  // Very short values would be revealed whole; show no tail for them.
  return {
    present: true,
    last4: trimmed.length >= 12 ? trimmed.slice(-4) : null,
  };
}
