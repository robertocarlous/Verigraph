// Signs each IntegrityReport with Verigraph's relayer/settlement wallet key
// (EIP-191 personal_sign) so any querying agent can verify the response came
// from the same identity that settled their payment and wasn't altered in
// transit — a non-repudiation guarantee scoped to *this* key, not a claim
// that the underlying OKX API data itself is honest (that would need an
// oracle/attestation layer on top, a much bigger undertaking — see README).
//
// Deliberately NOT the ASP's OKX.AI marketplace identity (a separate,
// TEE-secured wallet with no exportable raw private key — see README
// "Listing on OKX.AI") — this key exists specifically because settlement
// needs one that can sign/broadcast transactions programmatically.

import type { IntegrityReport } from "../types.js";

/**
 * Deterministic JSON serialization (object keys sorted recursively) so the
 * exact same bytes are signed here and reconstructed by a verifier —
 * `JSON.stringify`'s key order is insertion order, not a guaranteed wire
 * contract, so this can't rely on it matching what a client rebuilds.
 */
export function canonicalizeReport(report: IntegrityReport): string {
  return stableStringify(report);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}
