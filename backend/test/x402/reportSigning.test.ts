import { describe, expect, it } from "vitest";
import { canonicalizeReport } from "../../src/x402/reportSigning.js";
import type { IntegrityReport } from "../../src/types.js";

function baseReport(): IntegrityReport {
  return {
    target: { walletAddress: `0x${"aa".repeat(20)}` },
    integrityScore: 100,
    label: "ORGANIC",
    signals: { reputationGraph: null, txPatterns: null, onchainCrossRef: null },
    evidence: [],
    meta: { chain: "196", generatedAt: "2026-07-11T00:00:00.000Z", dataWindow: { begin: "a", end: "b" } },
  };
}

describe("canonicalizeReport", () => {
  it("is stable across different key insertion orders for an equivalent object", () => {
    const a = baseReport();
    const b = {
      label: a.label,
      target: { walletAddress: a.target.walletAddress },
      meta: { dataWindow: { end: a.meta.dataWindow.end, begin: a.meta.dataWindow.begin }, generatedAt: a.meta.generatedAt, chain: a.meta.chain },
      evidence: a.evidence,
      integrityScore: a.integrityScore,
      signals: a.signals,
    } as IntegrityReport;

    expect(canonicalizeReport(a)).toBe(canonicalizeReport(b));
  });

  it("differs when a value actually changes", () => {
    const a = baseReport();
    const b = { ...baseReport(), integrityScore: 42 };
    expect(canonicalizeReport(a)).not.toBe(canonicalizeReport(b));
  });
});
