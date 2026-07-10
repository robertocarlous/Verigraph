import { describe, expect, it } from "vitest";
import { analyzeTxPatterns } from "../../src/detection/txPatterns.js";
import { collusiveTxHistory, organicTxHistory } from "../fixtures/txHistory.js";

describe("analyzeTxPatterns", () => {
  it("scores irregular, market-varied trading as low suspicion", () => {
    const result = analyzeTxPatterns("0xOrganicWallet", organicTxHistory);
    expect(result.suspicionScore).toBeLessThan(0.3);
  });

  it("flags regular-cadence, round-tripping transfers as high suspicion", () => {
    const result = analyzeTxPatterns("0xCollusiveWallet", collusiveTxHistory);
    expect(result.suspicionScore).toBeGreaterThan(0.5);
    expect(result.details.roundTripPairCount).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.summary.includes("round-tripping") || e.summary.toLowerCase().includes("value"))).toBe(true);
  });

  it("reports insufficient data for tiny histories", () => {
    const result = analyzeTxPatterns("0xNewWallet", organicTxHistory.slice(0, 2));
    expect(result.suspicionScore).toBe(0);
    expect(result.details.insufficientData).toBe(true);
  });
});
