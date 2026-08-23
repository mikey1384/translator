/**
 * A small insertion-ordered map for recent-operation tombstones and metadata.
 * Updating an existing key makes it newest. Eviction is deterministic and does
 * not depend on timers, so long-running renderer sessions stay bounded.
 */
export class BoundedRecentMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError('maxEntries must be a non-negative integer');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  set(key: K, value: V): this {
    this.entries.delete(key);
    this.entries.set(key, value);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    return this;
  }
}
