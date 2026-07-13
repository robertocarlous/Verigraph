// Server-wide configuration. Deliberately lazy/partial: /v1/health and
// /v1/pricing must work with zero OKX credentials and even without a live
// RPC endpoint configured (see plan §Verification) — only the paid
// /v1/integrity-check route actually needs everything wired up. Each piece
// is resolved independently and reported missing-vs-present, rather than
// one big eager validation that would crash the whole server on boot.

import { ethers } from "ethers";
import { existsSync, readFileSync } from "node:fs";
import { optionalEnv } from "./env.js";
import type { SettlementContract } from "./x402/settle.js";
import type { ChallengeConfig } from "./x402/challenge.js";

export interface DeployedTokenInfo {
  address: string;
  chainId: number;
}

function loadDeployedTokenInfo(): DeployedTokenInfo | undefined {
  const explicit = process.env.DEMO_TOKEN_ADDRESS;
  if (explicit) {
    return { address: explicit, chainId: Number(optionalEnv("CHAIN_ID", "1952")) };
  }
  if (existsSync("contract/.deployed-token.json")) {
    const parsed = JSON.parse(readFileSync("contract/.deployed-token.json", "utf8")) as { address: string; chainId: number };
    return { address: parsed.address, chainId: parsed.chainId };
  }
  return undefined;
}

export interface PaymentContext {
  chainId: number;
  provider: ethers.Provider;
  contract: SettlementContract;
  challengeConfig: ChallengeConfig;
  /** Public RPC endpoint — safe to expose so a browser wallet can add/switch to this chain. */
  rpcUrl: string;
  /** Derives from RELAYER_PRIVATE_KEY — a separate, exportable settlement key, deliberately NOT the OKX.AI marketplace ASP identity (that's a different, TEE-secured wallet with no exportable key). See reportSigning.ts. */
  signerAddress: string;
  signMessage: (message: string) => Promise<string>;
}

const DEMO_TOKEN_ABI = [
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) external",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export interface PaymentContextResult {
  context?: PaymentContext;
  missing: string[];
}

/**
 * Builds everything the x402 gate needs. Returns `missing` (env var names)
 * instead of throwing so the server can boot and report a clear 503 on the
 * paid route rather than crashing outright when credentials/keys aren't in
 * place yet (true today — no OKX creds or funded wallets exist).
 */
export async function buildPaymentContext(): Promise<PaymentContextResult> {
  const missing: string[] = [];
  const rpcUrl = process.env.XLAYER_TESTNET_RPC_URL;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const payTo = process.env.SERVICE_WALLET_ADDRESS;
  const tokenInfo = loadDeployedTokenInfo();

  if (!rpcUrl) missing.push("XLAYER_TESTNET_RPC_URL");
  if (!relayerKey) missing.push("RELAYER_PRIVATE_KEY");
  if (!payTo) missing.push("SERVICE_WALLET_ADDRESS");
  if (!tokenInfo) missing.push("DEMO_TOKEN_ADDRESS (or run contract/deployDemoToken.ts)");

  if (!rpcUrl || !relayerKey || !payTo || !tokenInfo) {
    return { missing };
  }

  // `staticNetwork` skips ethers' own eth_chainId auto-detect handshake and
  // trusts the chain id already recorded alongside the deployed token —
  // confirmed live: plain auto-detection against this RPC endpoint
  // intermittently times out even though the endpoint itself responds fine
  // to a direct JSON-RPC call, so avoid the extra round trip entirely.
  const provider = new ethers.JsonRpcProvider(rpcUrl, tokenInfo.chainId, { staticNetwork: true });
  let chainId: number;
  try {
    chainId = Number((await provider.getNetwork()).chainId);
  } catch (err) {
    return { missing: [`unreachable XLAYER_TESTNET_RPC_URL (${(err as Error).message})`] };
  }

  const relayer = new ethers.Wallet(relayerKey, provider);
  // `SettlementContract` only needs `transferWithAuthorization`, which exists at runtime via
  // the raw ABI but isn't visible to ethers' static Contract typing without TypeChain.
  const contract = new ethers.Contract(tokenInfo.address, DEMO_TOKEN_ABI, relayer) as unknown as SettlementContract;

  const challengeConfig: ChallengeConfig = {
    payTo,
    tokenAddress: tokenInfo.address,
    tokenName: optionalEnv("DEMO_TOKEN_NAME", "Verigraph Demo USD"),
    tokenVersion: optionalEnv("DEMO_TOKEN_VERSION", "1"),
    tokenDecimals: Number(optionalEnv("DEMO_TOKEN_DECIMALS", "6")),
    chainId,
    priceAtomicUnits: BigInt(optionalEnv("PRICE_ATOMIC_UNITS", "10000")), // default 0.01 vUSD @ 6 decimals
    maxTimeoutSeconds: Number(optionalEnv("PAYMENT_MAX_TIMEOUT_SECONDS", "120")),
  };

  return {
    context: {
      chainId,
      provider,
      contract,
      challengeConfig,
      rpcUrl,
      signerAddress: relayer.address,
      signMessage: (message) => relayer.signMessage(message),
    },
    missing: [],
  };
}

// Confirmed live against the real API: `dex-history` rejects chainIndex "1952"
// (X Layer testnet) with `{code: "51000", msg: "chain id param error"}` — it's
// mainnet-only (no real DEX market data exists for a testnet). So this
// defaults to "196" even though the x402/self-play demo runs on testnet
// (a separate, independently-configured chain via XLAYER_TESTNET_RPC_URL) —
// the *target agent being checked* is a real mainnet agent; only Verigraph's
// own payment rail and self-play wallets are on testnet.
export const okxChainIndex = optionalEnv("CHAIN_INDEX", "196");
export const integrityCheckWindowDays = Number(optionalEnv("INTEGRITY_CHECK_WINDOW_DAYS", "90"));
export const onchainLookbackBlocks = Number(optionalEnv("ONCHAIN_LOOKBACK_BLOCKS", "50000"));
export const serverPort = Number(optionalEnv("PORT", "8402"));
