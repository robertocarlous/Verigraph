// Builds the 402 `accepts[]` challenge we issue as a seller. Pure/offline —
// no network calls — so it's trivially unit-testable.

import type { X402Accept, X402Challenge } from "./types.js";

export interface ChallengeConfig {
  payTo: string;
  tokenAddress: string;
  tokenName: string;
  tokenVersion: string;
  tokenDecimals: number;
  chainId: number;
  priceAtomicUnits: bigint;
  maxTimeoutSeconds: number;
}

export function buildChallenge(config: ChallengeConfig, resource?: string): X402Challenge {
  const accept: X402Accept = {
    scheme: "exact",
    network: `eip155:${config.chainId}`,
    asset: config.tokenAddress,
    payTo: config.payTo,
    amount: config.priceAtomicUnits.toString(),
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {
      name: config.tokenName,
      version: config.tokenVersion,
      decimals: config.tokenDecimals,
    },
  };
  return { x402Version: 2, accepts: [accept], resource };
}

export function encodeChallengeHeader(challenge: X402Challenge): string {
  return Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
}

export function decodePaymentRequiredHeader(headerValue: string): X402Challenge {
  const json = Buffer.from(headerValue, "base64").toString("utf8");
  return JSON.parse(json) as X402Challenge;
}
