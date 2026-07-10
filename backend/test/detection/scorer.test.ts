import { describe, expect, it } from "vitest";
import { analyzeReputationGraph } from "../../src/detection/reputationGraph.js";
import { analyzeTxPatterns } from "../../src/detection/txPatterns.js";
import { buildIntegrityReport } from "../../src/detection/scorer.js";
import {
  TARGET_ID,
  collusiveReviewerOwnReviews,
  collusiveReviews,
  organicReviewerOwnReviews,
  organicReviews,
} from "../fixtures/reviews.js";
import { collusiveTxHistory, organicTxHistory } from "../fixtures/txHistory.js";

const window = { begin: "2026-01-01", end: "2026-05-01" };

describe("buildIntegrityReport", () => {
  it("labels a fully organic agent as ORGANIC with a high integrity score", () => {
    const reputationGraph = analyzeReputationGraph({
      targetId: "999",
      targetReviews: organicReviews,
      reviewerOwnReviews: organicReviewerOwnReviews,
    });
    const txPatterns = analyzeTxPatterns("0xOrganic", organicTxHistory);
    const report = buildIntegrityReport({
      target: { walletAddress: "0xOrganic", agentId: "999" },
      reputationGraph,
      txPatterns,
      onchainCrossRef: null,
      chain: "xlayer_test",
      dataWindow: window,
    });
    expect(report.label).toBe("ORGANIC");
    expect(report.integrityScore).toBeGreaterThan(70);
  });

  it("labels a colluding agent as LIKELY_MANUFACTURED with a low integrity score and cites evidence", () => {
    const reputationGraph = analyzeReputationGraph({
      targetId: TARGET_ID,
      targetReviews: collusiveReviews,
      reviewerOwnReviews: collusiveReviewerOwnReviews,
    });
    const txPatterns = analyzeTxPatterns("0xColluder", collusiveTxHistory);
    const report = buildIntegrityReport({
      target: { walletAddress: "0xColluder", agentId: TARGET_ID },
      reputationGraph,
      txPatterns,
      onchainCrossRef: null,
      chain: "xlayer_test",
      dataWindow: window,
    });
    expect(report.label).toBe("LIKELY_MANUFACTURED");
    expect(report.integrityScore).toBeLessThan(40);
    expect(report.evidence.length).toBeGreaterThan(0);
    expect(report.evidence[0]!.severity).toBe("high");
  });

  it("redistributes weight gracefully when a signal module is unavailable", () => {
    const reputationGraph = analyzeReputationGraph({
      targetId: TARGET_ID,
      targetReviews: collusiveReviews,
      reviewerOwnReviews: collusiveReviewerOwnReviews,
    });
    const report = buildIntegrityReport({
      target: { walletAddress: "0xColluder" },
      reputationGraph,
      txPatterns: null,
      onchainCrossRef: null,
      chain: "xlayer_test",
      dataWindow: window,
    });
    expect(report.label).toBe("LIKELY_MANUFACTURED");
    expect(report.signals.txPatterns).toBeNull();
  });
});
