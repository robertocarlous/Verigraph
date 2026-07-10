// BRIDGING detection signal.
//
// dex-history has no counterparty field, so `txPatterns.ts` can only reason
// about a single wallet's own timeline. Once `reputationGraph.ts` flags a
// suspect counterparty (typically the top-concentrated reviewer, resolved to
// its wallet address by the caller), this module goes straight to the source
// of truth — ERC-20 `Transfer` event logs on X Layer itself, fetched via
// `eth_getLogs` against the two specific wallets — to check whether they have
// a real, direct, reciprocal on-chain relationship. This is a targeted,
// bounded query (not an open-ended indexer), so it stays cheap: `Transfer`'s
// `from`/`to` are indexed topics, so we filter server-side rather than
// scanning blocks.

import { ethers } from "ethers";
import type { EvidenceItem, SignalResult, TxRecord } from "../types.js";
import { clamp01 } from "./stats.js";

const ERC20_TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const MAX_LOGS_TO_TIMESTAMP = 50; // bound RPC calls when fetching block timestamps

export interface CrossRefInput {
  provider: ethers.Provider;
  walletA: string;
  walletB: string;
  /** ERC-20 contracts to check — typically the intersection of tokens both wallets have traded/held. */
  candidateTokenAddresses: string[];
  fromBlock: number;
  toBlock: number | "latest";
  /** Optional: both wallets' own dex-history, used to corroborate value/timing of matched on-chain transfers. */
  walletADexHistory?: TxRecord[];
  walletBDexHistory?: TxRecord[];
}

interface MatchedTransfer {
  tokenAddress: string;
  tokenSymbol: string;
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  amountFormatted: number;
  timestampMs?: number;
}

async function fetchTransfersBetween(
  provider: ethers.Provider,
  tokenAddress: string,
  walletA: string,
  walletB: string,
  fromBlock: number,
  toBlock: number | "latest",
): Promise<MatchedTransfer[]> {
  const contract = new ethers.Contract(tokenAddress, ERC20_TRANSFER_ABI, provider);
  let decimals = 18;
  let symbol = "?";
  try {
    decimals = Number(await contract.decimals!());
  } catch {
    // non-standard token; fall back to 18
  }
  try {
    symbol = String(await contract.symbol!());
  } catch {
    // optional
  }

  const filterAtoB = contract.filters.Transfer!(walletA, walletB);
  const filterBtoA = contract.filters.Transfer!(walletB, walletA);
  const [aToB, bToA] = await Promise.all([
    contract.queryFilter!(filterAtoB, fromBlock, toBlock),
    contract.queryFilter!(filterBtoA, fromBlock, toBlock),
  ]);

  const all = [...aToB, ...bToA] as ethers.EventLog[];
  return all
    .filter((log): log is ethers.EventLog => "args" in log && !!log.args)
    .map((log) => ({
      tokenAddress,
      tokenSymbol: symbol,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      from: String(log.args[0]),
      to: String(log.args[1]),
      amountFormatted: Number(ethers.formatUnits(log.args[2] as bigint, decimals)),
    }));
}

async function attachTimestamps(provider: ethers.Provider, transfers: MatchedTransfer[]): Promise<void> {
  const capped = transfers.slice(0, MAX_LOGS_TO_TIMESTAMP);
  const blockCache = new Map<number, number>();
  for (const t of capped) {
    let ts = blockCache.get(t.blockNumber);
    if (ts === undefined) {
      const block = await provider.getBlock(t.blockNumber);
      ts = block ? block.timestamp * 1000 : undefined;
      if (ts !== undefined) blockCache.set(t.blockNumber, ts);
    }
    t.timestampMs = ts;
  }
}

export async function crossReferenceCounterparty(input: CrossRefInput): Promise<SignalResult> {
  const { provider, walletA, walletB, candidateTokenAddresses, fromBlock, toBlock } = input;
  const evidence: EvidenceItem[] = [];

  if (candidateTokenAddresses.length === 0) {
    return {
      suspicionScore: 0,
      evidence: [
        {
          module: "onchainCrossRef",
          severity: "info",
          summary: "No shared candidate token contracts to check — cross-reference skipped.",
          refs: [],
        },
      ],
      details: { insufficientData: true },
    };
  }

  const results = await Promise.all(
    candidateTokenAddresses.map((token) =>
      fetchTransfersBetween(provider, token, walletA, walletB, fromBlock, toBlock).catch(() => [] as MatchedTransfer[]),
    ),
  );
  const transfers = results.flat().sort((a, b) => a.blockNumber - b.blockNumber);
  await attachTimestamps(provider, transfers);

  if (transfers.length === 0) {
    return {
      suspicionScore: 0,
      evidence: [
        {
          module: "onchainCrossRef",
          severity: "info",
          summary: `No direct on-chain transfers found between ${walletA} and ${walletB} in the scanned range.`,
          refs: [],
        },
      ],
      details: { transferCount: 0 },
    };
  }

  const aToB = transfers.filter((t) => t.from.toLowerCase() === walletA.toLowerCase());
  const bToA = transfers.filter((t) => t.from.toLowerCase() === walletB.toLowerCase());
  const bothDirections = aToB.length > 0 && bToA.length > 0;

  let suspicionScore: number;
  if (bothDirections && transfers.length >= 2) {
    suspicionScore = clamp01(0.75 + 0.05 * Math.min(5, transfers.length - 2));
    evidence.push({
      module: "onchainCrossRef",
      severity: "high",
      summary: `Confirmed direct, reciprocal on-chain transfers between ${walletA} and ${walletB}: ${aToB.length} transfer(s) A→B and ${bToA.length} B→A across ${new Set(transfers.map((t) => t.tokenAddress)).size} token(s) — this is the flagged reviewer's wallet actually exchanging value back and forth with the target, not just leaving reviews.`,
      refs: transfers.map((t) => t.txHash),
    });
  } else {
    suspicionScore = 0.35;
    evidence.push({
      module: "onchainCrossRef",
      severity: "warn",
      summary: `${transfers.length} one-directional transfer(s) found between ${walletA} and ${walletB} — a real payment relationship exists but no confirmed round-trip yet.`,
      refs: transfers.map((t) => t.txHash),
    });
  }

  return {
    suspicionScore,
    evidence,
    details: {
      transferCount: transfers.length,
      aToBCount: aToB.length,
      bToACount: bToA.length,
      bothDirections,
      tokens: [...new Set(transfers.map((t) => t.tokenAddress))],
    },
  };
}
