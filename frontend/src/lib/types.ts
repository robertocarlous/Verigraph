// Mirrors backend/src/types.ts and backend/src/x402/types.ts — this is the
// wire format both sides already agree on, kept as a plain, dependency-free
// copy here rather than importing across the frontend/backend project
// boundary (separate tsconfigs, separate build outputs).

export interface ResolvedAgent {
  agentId?: string;
  walletAddress: string;
  role?: string;
  name?: string;
}

export type IntegrityLabel = "ORGANIC" | "MIXED_SIGNAL" | "LIKELY_MANUFACTURED" | "INSUFFICIENT_DATA";

export interface EvidenceItem {
  module: "reputationGraph" | "txPatterns" | "onchainCrossRef";
  severity: "info" | "warn" | "high";
  summary: string;
  refs: string[];
}

export interface SignalResult {
  suspicionScore: number;
  evidence: EvidenceItem[];
  details: Record<string, unknown>;
}

export interface IntegrityReport {
  target: ResolvedAgent;
  integrityScore: number;
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

/** The paid endpoint's actual response: the report plus an EIP-191 signature
 * over its canonical JSON (see backend/src/x402/reportSigning.ts) from the
 * ASP's own service wallet — proves the response came from Verigraph and
 * wasn't altered in transit. `signature`/`signer` are themselves excluded
 * from what was signed. */
export type SignedIntegrityReport = IntegrityReport & { signature: string; signer: string };

export interface PricingInfo {
  configured: boolean;
  missingConfig?: string[];
  scheme?: "exact";
  network?: string; // "eip155:1952"
  asset?: string;
  symbol?: string;
  amountAtomic?: string;
  decimals?: number;
  payTo?: string;
  rpcUrl?: string;
  signerAddress?: string;
}

export interface X402Accept {
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; decimals: number };
}

export interface X402Challenge {
  x402Version: 2;
  accepts: X402Accept[];
  resource?: string;
}

export interface ExactPaymentPayload {
  scheme: "exact";
  network: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: { v: number; r: string; s: string };
}
