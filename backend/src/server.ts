// Express app: the ASP's live surface. POST /v1/integrity-check is the paid
// product (x402-gated); GET /v1/pricing and GET /v1/health are free and must
// work with zero OKX credentials / RPC connectivity (see plan §Verification)
// so the service is inspectable before anything is fully configured.

import "./env.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { buildPaymentContext, integrityCheckWindowDays, okxChainIndex, onchainLookbackBlocks, serverPort } from "./config.js";
import { analyzeReputationGraph } from "./detection/reputationGraph.js";
import { analyzeTxPatterns } from "./detection/txPatterns.js";
import { crossReferenceCounterparty } from "./detection/onchainCrossRef.js";
import { buildIntegrityReport } from "./detection/scorer.js";
import { startSessionWatchdog } from "./onchainos/authManager.js";
import { feedbackList, getAgentsByIds } from "./onchainos/cliClient.js";
import { fetchDexHistory, loadCredentialsFromEnv, OnchainOsRestClient } from "./onchainos/restClient.js";
import { requirePayment } from "./x402/middleware.js";
import type { ResolvedAgent, ReviewRecord, SignalResult, TxRecord } from "./types.js";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_REVIEWERS_TO_CROSS_CHECK = 5;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function resolveTarget(identifier: string): Promise<ResolvedAgent> {
  if (EVM_ADDRESS_RE.test(identifier)) {
    return { walletAddress: identifier };
  }
  const agents = await getAgentsByIds([identifier]);
  const agent = agents[0];
  if (!agent || !agent.walletAddress) {
    throw new HttpError(404, `Could not resolve agent id "${identifier}" to an on-chain wallet address.`);
  }
  return agent;
}

async function loadReputationSignal(target: ResolvedAgent): Promise<SignalResult | null> {
  if (!target.agentId) return null; // no agentId -> no feedback-list to inspect
  let targetReviews: ReviewRecord[];
  try {
    targetReviews = await feedbackList(target.agentId);
  } catch (err) {
    console.error(`feedback-list failed for agent ${target.agentId}:`, err);
    return null;
  }

  const byReviewer = new Map<string, number>();
  for (const r of targetReviews) byReviewer.set(r.reviewerId, (byReviewer.get(r.reviewerId) ?? 0) + 1);
  const topReviewers = [...byReviewer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_REVIEWERS_TO_CROSS_CHECK)
    .map(([id]) => id);

  const reviewerOwnReviews = new Map<string, ReviewRecord[]>();
  await Promise.all(
    topReviewers.map(async (reviewerId) => {
      try {
        reviewerOwnReviews.set(reviewerId, await feedbackList(reviewerId));
      } catch {
        // best-effort — missing entries are treated as "no reciprocity data" by the module
      }
    }),
  );

  return analyzeReputationGraph({ targetId: target.agentId, targetReviews, reviewerOwnReviews });
}

async function loadTxPatternsSignal(walletAddress: string): Promise<{ signal: SignalResult | null; history: TxRecord[] }> {
  try {
    const creds = loadCredentialsFromEnv();
    const client = new OnchainOsRestClient(creds);
    const now = Date.now();
    const beginMs = now - integrityCheckWindowDays * 24 * 60 * 60 * 1000;
    const history = await fetchDexHistory(client, { address: walletAddress, chainIndex: okxChainIndex, beginMs, endMs: now });
    return { signal: analyzeTxPatterns(walletAddress, history), history };
  } catch (err) {
    console.error(`dex-history fetch failed for ${walletAddress}:`, err);
    return { signal: null, history: [] };
  }
}

async function loadCrossRefSignal(
  target: ResolvedAgent,
  targetHistory: TxRecord[],
  reputationSignal: SignalResult | null,
  provider: import("ethers").Provider,
): Promise<SignalResult | null> {
  const topReviewerId = (reputationSignal?.details as { top1ReviewerId?: string } | undefined)?.top1ReviewerId;
  if (!topReviewerId) return null;

  let suspectAgents: ResolvedAgent[];
  try {
    suspectAgents = await getAgentsByIds([topReviewerId]);
  } catch {
    return null;
  }
  const suspect = suspectAgents[0];
  if (!suspect?.walletAddress) return null;

  const { signal: suspectTxSignal, history: suspectHistory } = await loadTxPatternsSignal(suspect.walletAddress).catch(() => ({
    signal: null,
    history: [] as TxRecord[],
  }));
  void suspectTxSignal;

  const targetTokens = new Set(targetHistory.map((t) => t.tokenContractAddress));
  const suspectTokens = new Set(suspectHistory.map((t) => t.tokenContractAddress));
  const candidateTokens = [...targetTokens].filter((t) => suspectTokens.has(t));
  if (candidateTokens.length === 0) return null;

  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - onchainLookbackBlocks);

  return crossReferenceCounterparty({
    provider,
    walletA: target.walletAddress,
    walletB: suspect.walletAddress,
    candidateTokenAddresses: candidateTokens,
    fromBlock,
    toBlock: "latest",
  });
}

const integrityCheckBody = z.object({ target: z.string().min(1) });

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  const { context: paymentContext, missing } = await buildPaymentContext();
  if (missing.length > 0) {
    console.warn(`x402 payment gate not fully configured — missing: ${missing.join(", ")}. ` + `POST /v1/integrity-check will return 503 until these are set.`);
  } else {
    startSessionWatchdog();
  }

  app.get("/v1/health", (_req, res) => {
    res.json({ status: "ok", paymentConfigured: !!paymentContext, missingConfig: missing });
  });

  app.get("/v1/pricing", (_req, res) => {
    if (!paymentContext) {
      res.json({ configured: false, missingConfig: missing });
      return;
    }
    const { challengeConfig } = paymentContext;
    res.json({
      configured: true,
      scheme: "exact",
      network: `eip155:${challengeConfig.chainId}`,
      asset: challengeConfig.tokenAddress,
      symbol: challengeConfig.tokenName,
      amountAtomic: challengeConfig.priceAtomicUnits.toString(),
      decimals: challengeConfig.tokenDecimals,
      payTo: challengeConfig.payTo,
    });
  });

  const integrityCheckHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { target: identifier } = integrityCheckBody.parse(req.body);
      const target = await resolveTarget(identifier);

      const [reputationGraph, txResult] = await Promise.all([
        loadReputationSignal(target),
        loadTxPatternsSignal(target.walletAddress),
      ]);

      let onchainCrossRef: SignalResult | null = null;
      if (paymentContext) {
        onchainCrossRef = await loadCrossRefSignal(target, txResult.history, reputationGraph, paymentContext.provider).catch(
          (err) => {
            console.error("onchainCrossRef failed:", err);
            return null;
          },
        );
      }

      const now = Date.now();
      const report = buildIntegrityReport({
        target,
        reputationGraph,
        txPatterns: txResult.signal,
        onchainCrossRef,
        chain: okxChainIndex,
        dataWindow: {
          begin: new Date(now - integrityCheckWindowDays * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date(now).toISOString(),
        },
      });

      res.json(report);
    } catch (err) {
      next(err);
    }
  };

  if (paymentContext) {
    app.post("/v1/integrity-check", requirePayment({ challengeConfig: paymentContext.challengeConfig, contract: paymentContext.contract }), integrityCheckHandler);
  } else {
    app.post("/v1/integrity-check", (_req, res) => {
      res.status(503).json({ error: "payment gate not configured", missingConfig: missing });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  app.listen(serverPort, () => {
    console.log(`Verigraph ASP listening on :${serverPort}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exitCode = 1;
});
