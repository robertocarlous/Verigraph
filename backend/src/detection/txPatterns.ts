// SECONDARY / corroborating detection signal.
//
// Runs over a single wallet's own `dex-history` (see types.ts TxRecord — no
// counterparty field is available on this endpoint). It cannot prove collusion
// between two specific agents by itself, but it detects the behavioral
// fingerprints of scripted, machine-speed wash activity on the target's own
// timeline: unnaturally regular cadence, repeated near-identical values
// alternating in and out (round-tripping), and trade values that never track
// real market price/marketCap movement the way genuine trading does.

import type { EvidenceItem, SignalResult, TxRecord } from "../types.js";
import { clamp01, coefficientOfVariation, interArrivalDeltas } from "./stats.js";

const MIN_SAMPLE_SIZE = 5;
const CADENCE_COV_LOW = 0.35; // below this, timing is suspiciously regular
const ROUND_TRIP_VALUE_TOLERANCE = 0.03; // 3% — values this close count as "the same amount"
const ROUND_TRIP_MIN_RATIO = 0.4; // fraction of transfer volume that round-trips
const FLAT_MARKETCAP_MIN_SAMPLE = 5;

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function analyzeTxPatterns(walletAddress: string, txs: TxRecord[]): SignalResult {
  const evidence: EvidenceItem[] = [];

  if (txs.length < MIN_SAMPLE_SIZE) {
    return {
      suspicionScore: 0,
      evidence: [
        {
          module: "txPatterns",
          severity: "info",
          summary: `Only ${txs.length} transaction(s) on record for ${walletAddress} — too few to assess timing/value patterns.`,
          refs: [],
        },
      ],
      details: { txCount: txs.length, insufficientData: true },
    };
  }

  const sorted = [...txs].sort((a, b) => num(a.time) - num(b.time));
  const timestamps = sorted.map((t) => num(t.time));

  // ── Signal A: cadence regularity ──────────────────────────────────────
  const deltas = interArrivalDeltas(timestamps);
  const cov = coefficientOfVariation(deltas);
  let cadenceScore = 0;
  if (deltas.length >= 3 && cov <= CADENCE_COV_LOW) {
    cadenceScore = clamp01(1 - cov / CADENCE_COV_LOW);
    evidence.push({
      module: "txPatterns",
      severity: cov <= CADENCE_COV_LOW / 2 ? "high" : "warn",
      summary: `Transaction timing is unusually regular (coefficient of variation ${cov.toFixed(2)}) — consistent with a scripted loop rather than organic, human-triggered activity.`,
      refs: [],
    });
  }

  // ── Signal B: round-tripping — Transfer In/Out of near-identical value ─
  const transfersIn = sorted.filter((t) => t.type === "3");
  const transfersOut = sorted.filter((t) => t.type === "4");
  let roundTrippedValue = 0;
  let totalTransferValue = 0;
  const roundTripRefs: string[] = [];
  const usedOut = new Set<number>();
  for (const inTx of transfersIn) {
    const inVal = num(inTx.valueUsd);
    totalTransferValue += inVal;
    for (let j = 0; j < transfersOut.length; j++) {
      if (usedOut.has(j)) continue;
      const outTx = transfersOut[j]!;
      const outVal = num(outTx.valueUsd);
      if (inVal === 0 || outVal === 0) continue;
      const diff = Math.abs(inVal - outVal) / Math.max(inVal, outVal);
      if (diff <= ROUND_TRIP_VALUE_TOLERANCE) {
        usedOut.add(j);
        roundTrippedValue += inVal;
        roundTripRefs.push(`${inTx.time}<->${outTx.time}:$${inVal.toFixed(2)}`);
        break;
      }
    }
  }
  for (const outTx of transfersOut) totalTransferValue += num(outTx.valueUsd);
  const roundTripRatio = totalTransferValue === 0 ? 0 : (roundTrippedValue * 2) / totalTransferValue;
  let roundTripScore = 0;
  if (roundTripRefs.length > 0 && roundTripRatio >= ROUND_TRIP_MIN_RATIO) {
    roundTripScore = clamp01(roundTripRatio);
    evidence.push({
      module: "txPatterns",
      severity: roundTripRatio >= 0.7 ? "high" : "warn",
      summary: `${roundTripRefs.length} transfer pair(s) show near-identical inbound/outbound value (within ${(ROUND_TRIP_VALUE_TOLERANCE * 100).toFixed(0)}%), covering ${(roundTripRatio * 100).toFixed(0)}% of transfer volume — a hallmark of value round-tripping between two wallets.`,
      refs: roundTripRefs.slice(0, 10),
    });
  }

  // ── Signal C: flat marketCap/price despite repeated trades (BUY/SELL) ──
  const trades = sorted.filter((t) => t.type === "1" || t.type === "2");
  let flatMarketScore = 0;
  if (trades.length >= FLAT_MARKETCAP_MIN_SAMPLE) {
    const marketCaps = trades.map((t) => num(t.marketCap)).filter((v) => v > 0);
    if (marketCaps.length >= FLAT_MARKETCAP_MIN_SAMPLE) {
      const covMcap = coefficientOfVariation(marketCaps);
      if (covMcap < 0.02) {
        flatMarketScore = 0.5;
        evidence.push({
          module: "txPatterns",
          severity: "warn",
          summary: `${trades.length} trades occurred against an essentially unchanged market cap (CoV ${covMcap.toFixed(4)}) — inconsistent with trading against a live, independently-priced market.`,
          refs: [],
        });
      }
    }
  }

  const suspicionScore = clamp01(0.4 * cadenceScore + 0.45 * roundTripScore + 0.15 * flatMarketScore);

  return {
    suspicionScore,
    evidence,
    details: {
      txCount: txs.length,
      cadenceCov: cov,
      roundTripRatio,
      roundTripPairCount: roundTripRefs.length,
      transfersInCount: transfersIn.length,
      transfersOutCount: transfersOut.length,
      tradeCount: trades.length,
    },
  };
}
