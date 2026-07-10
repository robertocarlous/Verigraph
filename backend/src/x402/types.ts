// x402 "exact" scheme (EIP-3009 transferWithAuthorization) types — self-facilitated
// seller side. Mirrors the wire shapes documented in okx-agent-payments-protocol's
// SKILL.md (accepts[]/PAYMENT-REQUIRED/X-PAYMENT), scoped to just the `exact`
// scheme since that's what our own DemoEIP3009Token backs.

export interface X402Accept {
  scheme: "exact";
  network: string; // CAIP-2, e.g. "eip155:1952"
  asset: string; // ERC-20 contract address
  payTo: string;
  amount: string; // atomic units, decimal string
  maxTimeoutSeconds: number;
  extra: {
    name: string; // EIP-712 domain name of `asset`
    version: string; // EIP-712 domain version of `asset`
    decimals: number;
  };
}

export interface X402Challenge {
  x402Version: 2;
  accepts: X402Accept[];
  resource?: string;
}

/** Decoded `X-PAYMENT` payload for the `exact` scheme. */
export interface ExactPaymentPayload {
  scheme: "exact";
  network: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string; // bytes32 hex
  };
  signature: {
    v: number;
    r: string;
    s: string;
  };
}

export interface VerifiedPayment {
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: string;
  v: number;
  r: string;
  s: string;
}

export type VerifyResult = { ok: true; payment: VerifiedPayment } | { ok: false; reason: string };
