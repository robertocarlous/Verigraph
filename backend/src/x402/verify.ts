// Verifies a buyer's EIP-3009 `transferWithAuthorization` signature against
// our issued challenge. Pure EIP-712 signature recovery via ethers — no RPC
// call needed, so this is fully offline and unit-testable with a plain
// ethers.Wallet standing in for the buyer.

import { ethers } from "ethers";
import type { ChallengeConfig } from "./challenge.js";
import type { ExactPaymentPayload, VerifyResult } from "./types.js";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export function decodeXPaymentHeader(headerValue: string): ExactPaymentPayload {
  const json = Buffer.from(headerValue, "base64").toString("utf8");
  return JSON.parse(json) as ExactPaymentPayload;
}

export function encodeXPaymentHeader(payload: ExactPaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function verifyExactPayment(config: ChallengeConfig, payload: ExactPaymentPayload, nowMs = Date.now()): VerifyResult {
  if (payload.scheme !== "exact") return { ok: false, reason: `unsupported scheme "${payload.scheme}"` };
  if (payload.network !== `eip155:${config.chainId}`) {
    return { ok: false, reason: `network mismatch: expected eip155:${config.chainId}, got ${payload.network}` };
  }

  const { authorization, signature } = payload;
  let value: bigint, validAfter: bigint, validBefore: bigint;
  try {
    value = BigInt(authorization.value);
    validAfter = BigInt(authorization.validAfter);
    validBefore = BigInt(authorization.validBefore);
  } catch {
    return { ok: false, reason: "malformed authorization: value/validAfter/validBefore must be integer strings" };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce)) {
    return { ok: false, reason: "malformed authorization: nonce must be a 32-byte hex string" };
  }
  if (!ethers.isAddress(authorization.from) || !ethers.isAddress(authorization.to)) {
    return { ok: false, reason: "malformed authorization: from/to must be valid addresses" };
  }
  if (authorization.to.toLowerCase() !== config.payTo.toLowerCase()) {
    return { ok: false, reason: `payTo mismatch: expected ${config.payTo}, got ${authorization.to}` };
  }
  if (value < config.priceAtomicUnits) {
    return { ok: false, reason: `insufficient amount: requires ${config.priceAtomicUnits}, got ${value}` };
  }

  const nowSec = BigInt(Math.floor(nowMs / 1000));
  if (nowSec <= validAfter) return { ok: false, reason: "authorization not yet valid (validAfter in the future)" };
  if (nowSec >= validBefore) return { ok: false, reason: "authorization expired (validBefore in the past)" };

  const domain: ethers.TypedDataDomain = {
    name: config.tokenName,
    version: config.tokenVersion,
    chainId: config.chainId,
    verifyingContract: config.tokenAddress,
  };
  const value712 = {
    from: authorization.from,
    to: authorization.to,
    value,
    validAfter,
    validBefore,
    nonce: authorization.nonce,
  };

  let recovered: string;
  try {
    const signature65 = ethers.Signature.from({ v: signature.v, r: signature.r, s: signature.s }).serialized;
    recovered = ethers.verifyTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, value712, signature65);
  } catch (err) {
    return { ok: false, reason: `signature recovery failed: ${(err as Error).message}` };
  }

  if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
    return { ok: false, reason: "signature does not match the claimed `from` address" };
  }

  return {
    ok: true,
    payment: {
      from: authorization.from,
      to: authorization.to,
      value,
      validAfter,
      validBefore,
      nonce: authorization.nonce,
      v: signature.v,
      r: signature.r,
      s: signature.s,
    },
  };
}
