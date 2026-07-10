// Express middleware wiring: no X-PAYMENT -> issue 402 challenge; X-PAYMENT
// present -> verify (offline) -> reserve nonce -> settle on-chain
// (synchronous, confirmation-gated) -> attach settlement to the request and
// call next(). See challenge.ts / verify.ts / nonceStore.ts / settle.ts for
// the reasoning behind each step.

import type { NextFunction, Request, Response } from "express";
import type { ChallengeConfig } from "./challenge.js";
import { buildChallenge, encodeChallengeHeader } from "./challenge.js";
import { NonceStore } from "./nonceStore.js";
import type { SettlementContract, SettlementResult } from "./settle.js";
import { SettlementError, settlePayment } from "./settle.js";
import { decodeXPaymentHeader, verifyExactPayment } from "./verify.js";

declare module "express-serve-static-core" {
  interface Request {
    payment?: SettlementResult;
  }
}

export interface X402MiddlewareOptions {
  challengeConfig: ChallengeConfig;
  contract: SettlementContract;
  nonceStore?: NonceStore;
}

export function requirePayment(options: X402MiddlewareOptions) {
  const nonceStore = options.nonceStore ?? new NonceStore();

  return async function x402Middleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const paymentHeader = req.header("X-PAYMENT");
    if (!paymentHeader) {
      const challenge = buildChallenge(options.challengeConfig, req.originalUrl);
      res.status(402).set("PAYMENT-REQUIRED", encodeChallengeHeader(challenge)).json(challenge);
      return;
    }

    let payload;
    try {
      payload = decodeXPaymentHeader(paymentHeader);
    } catch {
      res.status(400).json({ error: "malformed X-PAYMENT header" });
      return;
    }

    const verification = verifyExactPayment(options.challengeConfig, payload);
    if (!verification.ok) {
      res.status(402).json({ error: "payment verification failed", reason: verification.reason });
      return;
    }

    const { payment } = verification;
    const reserved = nonceStore.reserve(options.challengeConfig.tokenAddress, payment.from, payment.nonce);
    if (!reserved) {
      res.status(409).json({
        error: "payment already in flight or recently settled — do not replay the same signature",
      });
      return;
    }

    try {
      const settlement = await settlePayment(options.contract, payment);
      res.setHeader(
        "PAYMENT-RESPONSE",
        Buffer.from(JSON.stringify({ status: "settled", ...settlement }), "utf8").toString("base64"),
      );
      req.payment = settlement;
      next();
    } catch (err) {
      nonceStore.release(options.challengeConfig.tokenAddress, payment.from, payment.nonce);
      const message = err instanceof SettlementError ? err.message : "settlement failed";
      res.status(402).json({ error: "settlement failed", reason: message });
    }
  };
}
