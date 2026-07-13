import type { ExactPaymentPayload, PricingInfo, SignedIntegrityReport, X402Challenge } from "./types";

export async function fetchPricing(): Promise<PricingInfo> {
  let res: Response;
  try {
    res = await fetch("/v1/pricing");
  } catch {
    throw new Error("Can't reach the Verigraph backend — is `npm run dev` (or `npm run dev:all`) running on :8402?");
  }
  const text = await res.text();
  if (!text) {
    throw new Error("Backend returned an empty response from /v1/pricing — it may have crashed or restarted. Check the backend terminal.");
  }
  return JSON.parse(text);
}

/** POSTs with no X-PAYMENT header — the server always answers 402 with a fresh challenge. */
export async function requestChallenge(target: string): Promise<X402Challenge> {
  const res = await fetch("/v1/integrity-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (res.status !== 402) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `expected a 402 payment challenge, got ${res.status}`);
  }
  return res.json();
}

export interface SettlementInfo {
  txHash?: string;
  [key: string]: unknown;
}

export async function submitPayment(
  target: string,
  payment: ExactPaymentPayload,
): Promise<{ report: SignedIntegrityReport; settlement: SettlementInfo | null }> {
  const paymentHeader = btoa(JSON.stringify(payment));
  const res = await fetch("/v1/integrity-check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT": paymentHeader },
    body: JSON.stringify({ target }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error + (body.reason ? `: ${body.reason}` : ""));
  }
  const settlementHeader = res.headers.get("PAYMENT-RESPONSE");
  const settlement = settlementHeader ? JSON.parse(atob(settlementHeader)) : null;
  return { report: body as SignedIntegrityReport, settlement };
}

export function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}
