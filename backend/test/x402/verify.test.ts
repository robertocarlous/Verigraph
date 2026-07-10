import { ethers } from "ethers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChallengeConfig } from "../../src/x402/challenge.js";
import type { ExactPaymentPayload } from "../../src/x402/types.js";
import { verifyExactPayment } from "../../src/x402/verify.js";

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

const buyer = new ethers.Wallet("0x" + "ab".repeat(32));

const config: ChallengeConfig = {
  payTo: `0x${"55".repeat(20)}`,
  tokenAddress: `0x${"66".repeat(20)}`,
  tokenName: "Verigraph Demo USD",
  tokenVersion: "1",
  tokenDecimals: 6,
  chainId: 1952,
  priceAtomicUnits: 10_000n,
  maxTimeoutSeconds: 120,
};

async function signAuthorization(overrides: Partial<Record<string, unknown>> = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const authorization = {
    from: buyer.address,
    to: config.payTo,
    value: 10_000n,
    validAfter: 0n,
    validBefore: BigInt(nowSec + 120),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
    ...overrides,
  };
  const domain: ethers.TypedDataDomain = {
    name: config.tokenName,
    version: config.tokenVersion,
    chainId: config.chainId,
    verifyingContract: config.tokenAddress,
  };
  const signature = await buyer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);
  const sig = ethers.Signature.from(signature);
  const payload: ExactPaymentPayload = {
    scheme: "exact",
    network: `eip155:${config.chainId}`,
    authorization: {
      from: authorization.from,
      to: authorization.to as string,
      value: authorization.value.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
      nonce: authorization.nonce as string,
    },
    signature: { v: sig.v, r: sig.r, s: sig.s },
  };
  return payload;
}

describe("verifyExactPayment", () => {
  beforeEach(() => {
    // nothing to reset — verify.ts is stateless
  });

  it("accepts a correctly signed, well-formed authorization", async () => {
    const payload = await signAuthorization();
    const result = verifyExactPayment(config, payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payment.from.toLowerCase()).toBe(buyer.address.toLowerCase());
      expect(result.payment.value).toBe(10_000n);
    }
  });

  it("rejects a tampered signature", async () => {
    const payload = await signAuthorization();
    const tampered = { ...payload, signature: { ...payload.signature, r: `0x${"ff".repeat(32)}` } };
    const result = verifyExactPayment(config, tampered);
    expect(result.ok).toBe(false);
  });

  it("rejects payment to the wrong address", async () => {
    const payload = await signAuthorization({ to: `0x${"99".repeat(20)}` });
    const result = verifyExactPayment(config, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/payTo mismatch/);
  });

  it("rejects an amount below the required price", async () => {
    const payload = await signAuthorization({ value: 1n });
    const result = verifyExactPayment(config, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/insufficient amount/);
  });

  it("rejects an expired authorization", async () => {
    const payload = await signAuthorization({ validBefore: BigInt(Math.floor(Date.now() / 1000) - 10) });
    const result = verifyExactPayment(config, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/);
  });

  it("rejects an authorization not yet valid", async () => {
    const payload = await signAuthorization({ validAfter: BigInt(Math.floor(Date.now() / 1000) + 3600) });
    const result = verifyExactPayment(config, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not yet valid/);
  });

  it("rejects a network/chainId mismatch", async () => {
    const payload = await signAuthorization();
    const wrongNetwork = { ...payload, network: "eip155:196" };
    const result = verifyExactPayment(config, wrongNetwork);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/network mismatch/);
  });
});
