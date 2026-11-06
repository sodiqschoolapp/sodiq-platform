/**
 * Task 10.1c: the decoded values of the largest prepared units (`outcomes` and `figures`), kept in
 * the process between reads. At three times the size a quarter's units of one branch are about
 * 24 MB of JSON each kind, parsed and decoded again on every read of a rating, the early-warning
 * list or the branch summary (Step 1 of the plan: a third of those reads, and the API process's
 * own work that made the Academic Vice Principal's home miss its target).
 *
 * A value is kept under the exact preparation it came from: the branch, the kind, the quarter, the
 * unit, the fields read, the moment and the snapshot of the preparation. A preparation is never
 * changed in place (`writeUnit` replaces the row with one of a later snapshot), so a key names
 * one stored value for good; whether that preparation may still be read is decided by the
 * database on every read (`usableCondition`), never by this cache. Readers only read a value.
 *
 * Bounded by the stored size of the values (`pg_column_size`, compressed): a stored megabyte
 * decodes to about nine in memory (measured at triple: 3.7 MB of a quarter's figures, 32 MB
 * decoded), so the bound keeps about 200 MB, every branch's current quarter at the school's
 * size. The least recently read go first.
 */
export const DECODED_CACHE_BYTES = 24 * 1024 * 1024;

export class DecodedCache {
  private readonly values = new Map<string, { value: unknown; bytes: number }>();
  private bytes = 0;
  /** The reads that found their value kept (for a test that the cache is used). */
  hits = 0;

  constructor(private readonly limit = DECODED_CACHE_BYTES) {}

  get(key: string): unknown {
    const found = this.values.get(key);
    if (found === undefined) return undefined;
    this.hits += 1;
    // Read again: the most recent, last in the order of the map.
    this.values.delete(key);
    this.values.set(key, found);
    return found.value;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  set(key: string, value: unknown, bytes: number): void {
    if (bytes > this.limit) return;
    const before = this.values.get(key);
    if (before !== undefined) {
      this.values.delete(key);
      this.bytes -= before.bytes;
    }
    this.values.set(key, { value, bytes });
    this.bytes += bytes;
    for (const [oldest, one] of this.values) {
      if (this.bytes <= this.limit) break;
      this.values.delete(oldest);
      this.bytes -= one.bytes;
    }
  }

  get size(): number {
    return this.values.size;
  }

  get storedBytes(): number {
    return this.bytes;
  }
}

/** The one cache of the process. */
export const decodedUnits = new DecodedCache();
