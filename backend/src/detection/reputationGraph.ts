// PRIMARY detection signal.
//
// dex-history (see txPatterns.ts) has no counterparty field, so the strongest
// available signal for "did two specific agents collude" is the reviewer/reviewee
// graph itself: OKX.AI's ERC-8004 reputation system (`agent feedback-list`)
// records who reviewed whom, when, at what score, with what text. Two colluding
// agents manufacturing reputation at machine speed leave fingerprints here that a
// human-paced organic marketplace does not: one counterparty dominating the review
// count, mutual review pairs swapped within minutes/hours of each other, bursts of
// reviews clustered tightly in time, near-identical review text, and scores
// pinned at the maximum with no natural variance.

import type { EvidenceItem, ReviewRecord, SignalResult } from "../types.js";
import { clamp01, groupBy, textSimilarity, topKShare } from "./stats.js";

export interface ReputationGraphInput {
  targetId: string;
  /** Reviews received BY the target agent. */
  targetReviews: ReviewRecord[];
  /**
   * For each distinct reviewer of the target, the reviews THAT REVIEWER has
   * received (used to test reciprocity: did the target review them back?).
   * Caller fetches this lazily/best-effort — missing entries are treated as
   * "no reciprocity data", not as evidence of innocence.
   */
  reviewerOwnReviews: Map<string, ReviewRecord[]>;
}

const MIN_SAMPLE_SIZE = 3;
const CONCENTRATION_HIGH = 0.5;
const CONCENTRATION_WARN = 0.3;
const RECIPROCITY_HIGH = 0.5;
const RECIPROCITY_WARN = 0.25;
const MUTUAL_TIGHT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const BURST_WINDOW_MS = 60 * 60 * 1000; // 1h
const BURST_MIN_COUNT = 3;
const DUPLICATE_TEXT_THRESHOLD = 0.6;
const PERFECT_SCORE_RATIO_HIGH = 0.9;

function parseDate(d: string): number {
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function analyzeReputationGraph(input: ReputationGraphInput): SignalResult {
  const { targetId, targetReviews, reviewerOwnReviews } = input;
  const evidence: EvidenceItem[] = [];

  if (targetReviews.length < MIN_SAMPLE_SIZE) {
    return {
      suspicionScore: 0,
      evidence: [
        {
          module: "reputationGraph",
          severity: "info",
          summary: `Only ${targetReviews.length} review(s) on record — too few to assess reputation integrity.`,
          refs: [],
        },
      ],
      details: { reviewCount: targetReviews.length, insufficientData: true },
    };
  }

  const byReviewer = groupBy(targetReviews, (r) => r.reviewerId);
  const reviewerCounts = [...byReviewer.entries()].map(([id, revs]) => ({ id, count: revs.length }));
  reviewerCounts.sort((a, b) => b.count - a.count);

  // ── Signal A: reviewer concentration ──────────────────────────────────
  const top1Share = topKShare(reviewerCounts.map((r) => r.count), 1);
  const top3Share = topKShare(reviewerCounts.map((r) => r.count), 3);
  let concentrationScore = 0;
  if (top1Share >= CONCENTRATION_HIGH) {
    concentrationScore = 1;
    const top = reviewerCounts[0]!;
    evidence.push({
      module: "reputationGraph",
      severity: "high",
      summary: `Reviewer #${top.id} alone accounts for ${(top1Share * 100).toFixed(0)}% of all reviews (${top.count}/${targetReviews.length}) — reputation is not diversified across counterparties.`,
      refs: byReviewer.get(top.id)!.map((r) => r.taskHash).filter((x): x is string => !!x),
    });
  } else if (top1Share >= CONCENTRATION_WARN) {
    concentrationScore = 0.5;
    const top = reviewerCounts[0]!;
    evidence.push({
      module: "reputationGraph",
      severity: "warn",
      summary: `Reviewer #${top.id} accounts for ${(top1Share * 100).toFixed(0)}% of all reviews — moderate concentration.`,
      refs: [],
    });
  }

  // ── Signal B: reciprocity (mutual review pairs) ───────────────────────
  const distinctReviewers = [...byReviewer.keys()];
  const mutualPairs: { reviewerId: string; gapMs: number; targetReview: ReviewRecord; reverseReview: ReviewRecord }[] = [];
  for (const reviewerId of distinctReviewers) {
    const reverseReviews = reviewerOwnReviews.get(reviewerId);
    if (!reverseReviews) continue;
    const reverseFromTarget = reverseReviews.filter((r) => r.reviewerId === targetId);
    if (reverseFromTarget.length === 0) continue;
    const forwardReview = byReviewer.get(reviewerId)![0]!;
    const reverseReview = reverseFromTarget[0]!;
    const gapMs = Math.abs(parseDate(forwardReview.date) - parseDate(reverseReview.date));
    mutualPairs.push({ reviewerId, gapMs, targetReview: forwardReview, reverseReview });
  }
  const reciprocityRatio = distinctReviewers.length === 0 ? 0 : mutualPairs.length / distinctReviewers.length;
  const tightMutualPairs = mutualPairs.filter((p) => p.gapMs <= MUTUAL_TIGHT_WINDOW_MS);
  let reciprocityScore = 0;
  if (reciprocityRatio >= RECIPROCITY_HIGH) {
    reciprocityScore = 1;
    evidence.push({
      module: "reputationGraph",
      severity: "high",
      summary: `${mutualPairs.length}/${distinctReviewers.length} reviewers (${(reciprocityRatio * 100).toFixed(0)}%) are in a mutual review relationship with the target — reviews are being swapped, not earned unilaterally.`,
      refs: mutualPairs.flatMap((p) => [p.targetReview.taskHash, p.reverseReview.taskHash]).filter((x): x is string => !!x),
    });
  } else if (reciprocityRatio >= RECIPROCITY_WARN) {
    reciprocityScore = 0.5;
  }
  if (tightMutualPairs.length > 0) {
    const boosted = clamp01(reciprocityScore + 0.3);
    reciprocityScore = boosted;
    evidence.push({
      module: "reputationGraph",
      severity: "high",
      summary: `${tightMutualPairs.length} mutual review pair(s) were exchanged within 24 hours of each other — consistent with an automated review-swap loop rather than two independent human-paced endorsements.`,
      refs: tightMutualPairs.map((p) => `reviewer:${p.reviewerId}`),
    });
  }

  // ── Signal C: rating burst (many reviews clustered in a tight time window) ─
  const sortedByTime = [...targetReviews].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  let maxBurst = 0;
  let burstWindowReviews: ReviewRecord[] = [];
  for (let i = 0; i < sortedByTime.length; i++) {
    const windowStart = parseDate(sortedByTime[i]!.date);
    const windowEnd = windowStart + BURST_WINDOW_MS;
    const inWindow = sortedByTime.filter((r) => {
      const t = parseDate(r.date);
      return t >= windowStart && t <= windowEnd;
    });
    if (inWindow.length > maxBurst) {
      maxBurst = inWindow.length;
      burstWindowReviews = inWindow;
    }
  }
  let burstScore = 0;
  if (maxBurst >= BURST_MIN_COUNT) {
    burstScore = clamp01(0.4 + 0.15 * (maxBurst - BURST_MIN_COUNT));
    evidence.push({
      module: "reputationGraph",
      severity: maxBurst >= BURST_MIN_COUNT + 2 ? "high" : "warn",
      summary: `${maxBurst} reviews landed within a single 1-hour window — machine-speed rating cadence inconsistent with organic human review timing.`,
      refs: burstWindowReviews.map((r) => r.taskHash).filter((x): x is string => !!x),
    });
  }

  // ── Signal D: near-duplicate review text ──────────────────────────────
  const withText = targetReviews.filter((r) => r.description && r.description.trim().length > 0);
  let duplicateScore = 0;
  if (withText.length >= 2) {
    let sumSim = 0;
    let pairs = 0;
    const dupPairs: string[] = [];
    for (let i = 0; i < withText.length; i++) {
      for (let j = i + 1; j < withText.length; j++) {
        const sim = textSimilarity(withText[i]!.description!, withText[j]!.description!);
        sumSim += sim;
        pairs++;
        if (sim >= DUPLICATE_TEXT_THRESHOLD) {
          dupPairs.push(`${withText[i]!.taskHash ?? withText[i]!.reviewerId} ~ ${withText[j]!.taskHash ?? withText[j]!.reviewerId}`);
        }
      }
    }
    const avgSim = pairs === 0 ? 0 : sumSim / pairs;
    if (avgSim >= DUPLICATE_TEXT_THRESHOLD) {
      duplicateScore = clamp01((avgSim - DUPLICATE_TEXT_THRESHOLD) / (1 - DUPLICATE_TEXT_THRESHOLD) * 0.6 + 0.4);
      evidence.push({
        module: "reputationGraph",
        severity: "warn",
        summary: `Review text is highly similar across reviews (avg. shingle similarity ${(avgSim * 100).toFixed(0)}%) — suggests templated or bot-generated feedback rather than varied human-written comments.`,
        refs: dupPairs.slice(0, 5),
      });
    }
  }

  // ── Signal E: score extremity (always 5.0, no natural variance) ───────
  const perfectCount = targetReviews.filter((r) => r.score >= 4.995).length;
  const perfectRatio = perfectCount / targetReviews.length;
  let extremityScore = 0;
  if (targetReviews.length >= 5 && perfectRatio >= PERFECT_SCORE_RATIO_HIGH) {
    extremityScore = 0.4;
    evidence.push({
      module: "reputationGraph",
      severity: "warn",
      summary: `${(perfectRatio * 100).toFixed(0)}% of reviews are a perfect 5.0 score with no variance — organic marketplaces rarely produce unanimous maximum ratings.`,
      refs: [],
    });
  }

  const suspicionScore = clamp01(
    0.3 * concentrationScore + 0.35 * reciprocityScore + 0.2 * burstScore + 0.1 * duplicateScore + 0.05 * extremityScore,
  );

  return {
    suspicionScore,
    evidence,
    details: {
      reviewCount: targetReviews.length,
      distinctReviewers: distinctReviewers.length,
      top1ReviewerId: reviewerCounts[0]?.id,
      top1Share,
      top3Share,
      reciprocityRatio,
      mutualPairCount: mutualPairs.length,
      tightMutualPairCount: tightMutualPairs.length,
      maxBurstCount: maxBurst,
      perfectScoreRatio: perfectRatio,
    },
  };
}
