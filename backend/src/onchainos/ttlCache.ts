// Tiny in-memory TTL cache. Used to keep repeat agent-identity/feedback
// lookups cheap without adding a database — see plan §5 ("No database/queue").

export class TtlCache<V> {
  private entries = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  async getOrCompute(key: string, compute: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }
}
