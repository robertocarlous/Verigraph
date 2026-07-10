import { describe, expect, it } from "vitest";
import { analyzeReputationGraph } from "../../src/detection/reputationGraph.js";
import {
  COLLUDER_ID,
  TARGET_ID,
  collusiveReviewerOwnReviews,
  collusiveReviews,
  organicReviewerOwnReviews,
  organicReviews,
} from "../fixtures/reviews.js";

describe("analyzeReputationGraph", () => {
  it("scores organic, diversified reviews as low suspicion", () => {
    const result = analyzeReputationGraph({
      targetId: "999",
      targetReviews: organicReviews,
      reviewerOwnReviews: organicReviewerOwnReviews,
    });
    expect(result.suspicionScore).toBeLessThan(0.3);
  });

  it("flags reciprocal review-swap loops with concentrated, near-duplicate text as high suspicion", () => {
    const result = analyzeReputationGraph({
      targetId: TARGET_ID,
      targetReviews: collusiveReviews,
      reviewerOwnReviews: collusiveReviewerOwnReviews,
    });
    expect(result.suspicionScore).toBeGreaterThan(0.6);
    expect(result.details.mutualPairCount).toBeGreaterThan(0);
    expect(result.details.tightMutualPairCount).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.severity === "high")).toBe(true);
  });

  it("reports insufficient data instead of guessing when review history is tiny", () => {
    const result = analyzeReputationGraph({
      targetId: TARGET_ID,
      targetReviews: collusiveReviews.slice(0, 1),
      reviewerOwnReviews: new Map(),
    });
    expect(result.suspicionScore).toBe(0);
    expect(result.details.insufficientData).toBe(true);
  });

  it("identifies the dominant reviewer id for concentration evidence", () => {
    const result = analyzeReputationGraph({
      targetId: TARGET_ID,
      targetReviews: collusiveReviews,
      reviewerOwnReviews: collusiveReviewerOwnReviews,
    });
    expect(result.details.top1Share).toBeCloseTo(4 / 5, 5);
    expect(result.evidence.some((e) => e.summary.includes(`#${COLLUDER_ID}`))).toBe(true);
  });
});
