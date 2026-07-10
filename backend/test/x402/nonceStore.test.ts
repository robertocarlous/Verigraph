import { describe, expect, it } from "vitest";
import { NonceStore } from "../../src/x402/nonceStore.js";

const TOKEN = "0xToken";
const FROM = "0xBuyer";
const NONCE = "0xNonce1";

describe("NonceStore", () => {
  it("reserves a fresh (token, from, nonce) tuple", () => {
    const store = new NonceStore();
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(true);
    expect(store.has(TOKEN, FROM, NONCE)).toBe(true);
  });

  it("refuses to reserve the same tuple twice — blocks concurrent replay", () => {
    const store = new NonceStore();
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(true);
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(false);
  });

  it("is case-insensitive on token/from/nonce", () => {
    const store = new NonceStore();
    expect(store.reserve(TOKEN.toLowerCase(), FROM.toLowerCase(), NONCE.toLowerCase())).toBe(true);
    expect(store.reserve(TOKEN.toUpperCase(), FROM.toUpperCase(), NONCE.toUpperCase())).toBe(false);
  });

  it("allows a retry after release (failed settlement)", () => {
    const store = new NonceStore();
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(true);
    store.release(TOKEN, FROM, NONCE);
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(true);
  });

  it("expires reservations after the TTL", async () => {
    const store = new NonceStore(10); // 10ms TTL
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.reserve(TOKEN, FROM, NONCE)).toBe(true);
  });

  it("keeps distinct nonces independent", () => {
    const store = new NonceStore();
    store.reserve(TOKEN, FROM, "0xA");
    expect(store.reserve(TOKEN, FROM, "0xB")).toBe(true);
    expect(store.size).toBe(2);
  });
});
