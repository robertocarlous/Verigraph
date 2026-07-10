import { describe, expect, it } from "vitest";
import { buildChallenge, decodePaymentRequiredHeader, encodeChallengeHeader } from "../../src/x402/challenge.js";
import type { ChallengeConfig } from "../../src/x402/challenge.js";

const config: ChallengeConfig = {
  payTo: `0x${"11".repeat(20)}`,
  tokenAddress: `0x${"22".repeat(20)}`,
  tokenName: "Verigraph Demo USD",
  tokenVersion: "1",
  tokenDecimals: 6,
  chainId: 1952,
  priceAtomicUnits: 10_000n,
  maxTimeoutSeconds: 120,
};

describe("x402 challenge", () => {
  it("builds a well-formed exact-scheme accepts[] challenge", () => {
    const challenge = buildChallenge(config, "/v1/integrity-check");
    expect(challenge.x402Version).toBe(2);
    expect(challenge.accepts).toHaveLength(1);
    const accept = challenge.accepts[0]!;
    expect(accept.scheme).toBe("exact");
    expect(accept.network).toBe("eip155:1952");
    expect(accept.amount).toBe("10000");
    expect(accept.payTo).toBe(config.payTo);
  });

  it("round-trips through base64 header encoding", () => {
    const challenge = buildChallenge(config);
    const header = encodeChallengeHeader(challenge);
    const decoded = decodePaymentRequiredHeader(header);
    expect(decoded).toEqual(challenge);
  });
});
