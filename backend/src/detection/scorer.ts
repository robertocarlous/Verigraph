// Combines the three signal modules into the final IntegrityReport. This is
// the only place that turns raw per-module suspicion scores into a single
// label — keep it pure and deterministic so it stays trivially testable.

import type { EvidenceItem, IntegrityLabel, IntegrityReport, ResolvedAgent, SignalResult } from "../types.js";
import { clamp01 } from "./stats.js";

const WEIGHT_REPUTATION = 0.5;
const WEIGHT_TX = 0.25;
const WEIGHT_CROSSREF = 0.25;

const LIKELY_MANUFACTURED_THRESHOLD = 0.6; // combined suspicion >= this -> LIKELY_MANUFACTURED
const MIXED_SIGNAL_THRESHOLD = 0.3; // combined suspicion >= this -> MIXED_SIGNAL

export interface ScoreInput {
  target: ResolvedAgent;
  reputationGraph: SignalResult | null;
  txPatterns: SignalResult | null;
  onchainCrossRef: SignalResult | null;
  chain: string;
  dataWindow: { begin: string; end: string };
}

function combinedSuspicion(input: ScoreInput): number {
  const parts: { weight: number; score: number }[] = [];
  if (input.reputationGraph) parts.push({ weight: WEIGHT_REPUTATION, score: input.reputationGraph.suspicionScore });
  if (input.txPatterns) parts.push({ weight: WEIGHT_TX, score: input.txPatterns.suspicionScore });
  if (input.onchainCrossRef) parts.push({ weight: WEIGHT_CROSSREF, score: input.onchainCrossRef.suspicionScore });

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = parts.reduce((a, p) => a + p.weight * p.score, 0);
  return clamp01(weighted / totalWeight);
}

function labelFor(suspicion: number, hasData: boolean): IntegrityLabel {
  if (!hasData) return "INSUFFICIENT_DATA";
  if (suspicion >= LIKELY_MANUFACTURED_THRESHOLD) return "LIKELY_MANUFACTURED";
  if (suspicion >= MIXED_SIGNAL_THRESHOLD) return "MIXED_SIGNAL";
  return "ORGANIC";
}

export function buildIntegrityReport(input: ScoreInput): IntegrityReport {
  // Every signal module null (network failure, sparse target, etc.) must not
  // silently read as "checked and found clean" — combinedSuspicion() has no
  // data to weigh and defaults to 0, which would otherwise land on ORGANIC
  // indistinguishably from a genuinely verified-clean result. Confirmed live:
  // this happened for a real target when dex-history timed out.
  const hasData = input.reputationGraph !== null || input.txPatterns !== null || input.onchainCrossRef !== null;
  const suspicion = combinedSuspicion(input);
  const integrityScore = Math.round((1 - suspicion) * 100);
  const label = labelFor(suspicion, hasData);

  const evidence: EvidenceItem[] = [
    ...(input.reputationGraph?.evidence ?? []),
    ...(input.txPatterns?.evidence ?? []),
    ...(input.onchainCrossRef?.evidence ?? []),
  ].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    target: input.target,
    integrityScore,
    label,
    signals: {
      reputationGraph: input.reputationGraph,
      txPatterns: input.txPatterns,
      onchainCrossRef: input.onchainCrossRef,
    },
    evidence,
    meta: {
      chain: input.chain,
      generatedAt: new Date().toISOString(),
      dataWindow: input.dataWindow,
    },
  };
}

function severityRank(s: EvidenceItem["severity"]): number {
  return s === "high" ? 2 : s === "warn" ? 1 : 0;
}
