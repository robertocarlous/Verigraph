import { describe, expect, it } from "vitest";
import type { SettlementContract } from "../../src/x402/settle.js";
import { SettlementError, settlePayment } from "../../src/x402/settle.js";
import type { VerifiedPayment } from "../../src/x402/types.js";

const payment: VerifiedPayment = {
  from: `0x${"11".repeat(20)}`,
  to: `0x${"22".repeat(20)}`,
  value: 10_000n,
  validAfter: 0n,
  validBefore: 9_999_999_999n,
  nonce: `0x${"33".repeat(32)}`,
  v: 27,
  r: `0x${"44".repeat(32)}`,
  s: `0x${"55".repeat(32)}`,
};

function mockContract(behavior: "success" | "revert" | "broadcast-throw"): SettlementContract {
  return {
    async transferWithAuthorization() {
      if (behavior === "broadcast-throw") throw new Error("insufficient relayer funds");
      return {
        async wait(_confirmations?: number) {
          if (behavior === "revert") return { status: 0, hash: "0xdeadbeef", blockNumber: 42 };
          return { status: 1, hash: "0xabc123", blockNumber: 42 };
        },
      };
    },
  };
}

describe("settlePayment", () => {
  it("returns tx hash and block number on a confirmed success", async () => {
    const result = await settlePayment(mockContract("success"), payment);
    expect(result.txHash).toBe("0xabc123");
    expect(result.blockNumber).toBe(42);
  });

  it("throws SettlementError when the transaction reverts", async () => {
    await expect(settlePayment(mockContract("revert"), payment)).rejects.toBeInstanceOf(SettlementError);
  });

  it("throws SettlementError when the broadcast itself fails", async () => {
    await expect(settlePayment(mockContract("broadcast-throw"), payment)).rejects.toBeInstanceOf(SettlementError);
  });
});
