// Shared domain types. Field names mirror OKX OnchainOS's documented wire
// format (see onchainos-skills SKILL.md / *-cli-reference.md) so that
// production data flows into detection with zero translation layer.

/** One row from `GET /api/v6/dex/market/portfolio/dex-history`. */
export interface TxRecord {
  /** "1"=BUY, "2"=SELL, "3"=Transfer In, "4"=Transfer Out */
  type: "1" | "2" | "3" | "4";
  chainIndex: string;
  tokenContractAddress: string;
  tokenSymbol: string;
  valueUsd: string;
  amount: string;
  price: string;
  marketCap: string;
  pnlUsd: string;
  /** Unix milliseconds, as a string per OKX convention. */
  time: string;
}

/** One row from `agent feedback-list` (`/priapi/.../agent/reviews`), CLI-normalized. */
export interface ReviewRecord {
  reviewerId: string;
  reviewerRole?: string;
  reviewerName?: string;
  /** Already converted to 0.00-5.00 by the CLI. */
  score: number;
  date: string;
  taskHash?: string;
  description?: string;
}

export interface ResolvedAgent {
  /** OKX.AI agent id, if the input identifier was one. */
  agentId?: string;
  /** On-chain wallet address, always populated. */
  walletAddress: string;
  role?: string;
  name?: string;
}

export type IntegrityLabel = "ORGANIC" | "MIXED_SIGNAL" | "LIKELY_MANUFACTURED" | "INSUFFICIENT_DATA";

export interface EvidenceItem {
  module: "reputationGraph" | "txPatterns" | "onchainCrossRef";
  severity: "info" | "warn" | "high";
  summary: string;
  /** tx hashes / review ids / explorer links / addresses backing this claim. */
  refs: string[];
}

export interface SignalResult {
  /** 0 (no suspicion) .. 1 (maximal suspicion) contribution from this module. */
  suspicionScore: number;
  evidence: EvidenceItem[];
  details: Record<string, unknown>;
}

export interface IntegrityReport {
  target: ResolvedAgent;
  integrityScore: number; // 0-100, 100 = fully organic
  label: IntegrityLabel;
  signals: {
    reputationGraph: SignalResult | null;
    txPatterns: SignalResult | null;
    onchainCrossRef: SignalResult | null;
  };
  evidence: EvidenceItem[];
  meta: {
    chain: string;
    generatedAt: string;
    dataWindow: { begin: string; end: string };
  };
}
