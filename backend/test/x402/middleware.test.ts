import express from "express";
import type { AddressInfo } from "node:net";
import { ethers } from "ethers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChallengeConfig } from "../../src/x402/challenge.js";
import { decodePaymentRequiredHeader } from "../../src/x402/challenge.js";
import type { SettlementContract } from "../../src/x402/settle.js";
import { requirePayment } from "../../src/x402/middleware.js";
import type { ExactPaymentPayload } from "../../src/x402/types.js";

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

const buyer = new ethers.Wallet("0x" + "cd".repeat(32));

const config: ChallengeConfig = {
  payTo: `0x${"77".repeat(20)}`,
  tokenAddress: `0x${"88".repeat(20)}`,
  tokenName: "Verigraph Demo USD",
  tokenVersion: "1",
  tokenDecimals: 6,
  chainId: 1952,
  priceAtomicUnits: 10_000n,
  maxTimeoutSeconds: 120,
};

let mockTxCounter = 0;
const mockContract: SettlementContract = {
  async transferWithAuthorization() {
    const hash = `0xmocktx${++mockTxCounter}`;
    return { async wait() { return { status: 1, hash, blockNumber: 100 + mockTxCounter }; } };
  },
};

const app = express();
app.post("/v1/integrity-check", requirePayment({ challengeConfig: config, contract: mockContract }), (req, res) => {
  res.json({ ok: true, payment: req.payment });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

async function signPayload(nonce = ethers.hexlify(ethers.randomBytes(32))): Promise<ExactPaymentPayload> {
  const nowSec = Math.floor(Date.now() / 1000);
  const authorization = {
    from: buyer.address,
    to: config.payTo,
    value: 10_000n,
    validAfter: 0n,
    validBefore: BigInt(nowSec + 120),
    nonce,
  };
  const domain: ethers.TypedDataDomain = {
    name: config.tokenName,
    version: config.tokenVersion,
    chainId: config.chainId,
    verifyingContract: config.tokenAddress,
  };
  const signature = await buyer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);
  const sig = ethers.Signature.from(signature);
  return {
    scheme: "exact",
    network: `eip155:${config.chainId}`,
    authorization: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
      nonce,
    },
    signature: { v: sig.v, r: sig.r, s: sig.s },
  };
}

function encodeXPayment(payload: ExactPaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe("x402 middleware end-to-end", () => {
  it("returns 402 with a decodable challenge when no payment is presented", async () => {
    const res = await fetch(`${baseUrl}/v1/integrity-check`, { method: "POST" });
    expect(res.status).toBe(402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const challenge = decodePaymentRequiredHeader(header!);
    expect(challenge.accepts[0]!.amount).toBe("10000");
  });

  it("settles a valid payment and returns 200 with the paid response", async () => {
    const payload = await signPayload();
    const res = await fetch(`${baseUrl}/v1/integrity-check`, {
      method: "POST",
      headers: { "X-PAYMENT": encodeXPayment(payload) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; payment: { txHash: string } };
    expect(body.ok).toBe(true);
    expect(body.payment.txHash).toMatch(/^0xmocktx/);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
  });

  it("rejects a replayed X-PAYMENT header with 409, not a second settlement", async () => {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const payload = await signPayload(nonce);
    const header = encodeXPayment(payload);

    const first = await fetch(`${baseUrl}/v1/integrity-check`, { method: "POST", headers: { "X-PAYMENT": header } });
    expect(first.status).toBe(200);

    const replay = await fetch(`${baseUrl}/v1/integrity-check`, { method: "POST", headers: { "X-PAYMENT": header } });
    expect(replay.status).toBe(409);
  });

  it("rejects an invalid signature with 402, not a 500", async () => {
    const payload = await signPayload();
    payload.signature.r = `0x${"ee".repeat(32)}`;
    const res = await fetch(`${baseUrl}/v1/integrity-check`, {
      method: "POST",
      headers: { "X-PAYMENT": encodeXPayment(payload) },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/verification failed/);
  });
});
