// Synchronous on-chain settlement. We do not depend on an OKX-hosted x402
// facilitator (none is documented for seller-side verify/settle) — instead we
// broadcast the buyer's signed EIP-3009 authorization ourselves and require at
// least one confirmation before the HTTP layer is allowed to serve the paid
// response. This is deliberately synchronous: settle-then-serve, never
// serve-then-settle-async, or a slow/failed broadcast would give away free
// service (see nonceStore.ts for the complementary pre-broadcast lock).

import type { VerifiedPayment } from "./types.js";

/** Structural interface so this module is testable with a mock, without importing ethers.Contract directly. */
export interface SettlementContract {
  transferWithAuthorization(
    from: string,
    to: string,
    value: bigint,
    validAfter: bigint,
    validBefore: bigint,
    nonce: string,
    v: number,
    r: string,
    s: string,
  ): Promise<{ wait(confirmations?: number): Promise<{ status: number | null; hash: string; blockNumber: number } | null> }>;
}

export class SettlementError extends Error {}

export interface SettlementResult {
  txHash: string;
  blockNumber: number;
}

// Confirmed live (see agent/transferLoop.ts): the RPC/proxy path to X Layer
// testnet from this environment intermittently times out or degrades even
// though the same call reliably succeeds on a clean connection. A single
// blip shouldn't fail a payment outright — retry the broadcast+confirm cycle
// with backoff. This is safe to retry: if an earlier attempt's broadcast
// never actually landed on-chain, the buyer's EIP-3009 authorization is
// still unused and a retry is just a fresh send of the same signed payload;
// if it DID land, the retry's `transferWithAuthorization` call simply
// reverts on-chain ("authorization already used") and we fall through to
// the error path having wasted a little relayer gas, not double-charged the
// buyer.
const SETTLE_RETRY_ATTEMPTS = 3;
const SETTLE_RETRY_BASE_DELAY_MS = 3000;

export interface SettleRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

export async function settlePayment(
  contract: SettlementContract,
  payment: VerifiedPayment,
  retry: SettleRetryOptions = {},
): Promise<SettlementResult> {
  const attempts = retry.attempts ?? SETTLE_RETRY_ATTEMPTS;
  const baseDelayMs = retry.baseDelayMs ?? SETTLE_RETRY_BASE_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await settleOnce(contract, payment);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastErr;
}

async function settleOnce(contract: SettlementContract, payment: VerifiedPayment): Promise<SettlementResult> {
  let txResponse;
  try {
    txResponse = await contract.transferWithAuthorization(
      payment.from,
      payment.to,
      payment.value,
      payment.validAfter,
      payment.validBefore,
      payment.nonce,
      payment.v,
      payment.r,
      payment.s,
    );
  } catch (err) {
    throw new SettlementError(`transferWithAuthorization broadcast failed: ${(err as Error).message}`);
  }

  const receipt = await txResponse.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new SettlementError(`settlement transaction reverted or was dropped (hash: ${receipt?.hash ?? "unknown"})`);
  }

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}
