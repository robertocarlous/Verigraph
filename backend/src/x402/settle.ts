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

export async function settlePayment(contract: SettlementContract, payment: VerifiedPayment): Promise<SettlementResult> {
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
