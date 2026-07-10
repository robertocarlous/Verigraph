// Pre-broadcast reservation lock. The token contract's own `authorizationState`
// mapping is the authoritative anti-replay defense (a used nonce reverts
// on-chain), but that only protects against a nonce being spent twice — it does
// nothing to stop N concurrent requests racing to replay the *same still-valid,
// not-yet-broadcast* signature to get N free responses before the first
// broadcast confirms. This in-memory store closes that window: reserve()
// must succeed before we ever call the contract, and settlement is awaited
// synchronously before the HTTP response is sent (see middleware.ts).

export class NonceStore {
  private reserved = new Map<string, number>(); // key -> reservedAt (ms)
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  private key(tokenAddress: string, from: string, nonce: string): string {
    return `${tokenAddress.toLowerCase()}:${from.toLowerCase()}:${nonce.toLowerCase()}`;
  }

  private sweep(now: number): void {
    for (const [k, t] of this.reserved) {
      if (now - t > this.ttlMs) this.reserved.delete(k);
    }
  }

  /** Returns true if this (token, from, nonce) was newly reserved; false if already in flight. */
  reserve(tokenAddress: string, from: string, nonce: string): boolean {
    const now = Date.now();
    this.sweep(now);
    const k = this.key(tokenAddress, from, nonce);
    if (this.reserved.has(k)) return false;
    this.reserved.set(k, now);
    return true;
  }

  /** Call after a failed settlement so a legitimate retry of the same signature isn't permanently blocked. */
  release(tokenAddress: string, from: string, nonce: string): void {
    this.reserved.delete(this.key(tokenAddress, from, nonce));
  }

  has(tokenAddress: string, from: string, nonce: string): boolean {
    return this.reserved.has(this.key(tokenAddress, from, nonce));
  }

  get size(): number {
    return this.reserved.size;
  }
}
