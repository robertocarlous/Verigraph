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

function mockContract(behavior: "success" | "revert" | "broadcast-throw", failFirstNCalls = 0): SettlementContract {
  let calls = 0;
  return {
    async transferWithAuthorization() {
      calls++;
      if (calls <= failFirstNCalls) throw new Error("transient RPC timeout");
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

// No-delay retry config for the failure-path tests below — they fail
// deterministically on every attempt, so the production backoff would just
// add ~9s of real wall-clock time per test for no additional coverage.
const FAST_FAIL = { attempts: 1, baseDelayMs: 0 };

describe("settlePayment", () => {
  it("returns tx hash and block number on a confirmed success", async () => {
    const result = await settlePayment(mockContract("success"), payment);
    expect(result.txHash).toBe("0xabc123");
    expect(result.blockNumber).toBe(42);
  });

  it("throws SettlementError when the transaction reverts", async () => {
    await expect(settlePayment(mockContract("revert"), payment, FAST_FAIL)).rejects.toBeInstanceOf(SettlementError);
  });

  it("throws SettlementError when the broadcast itself fails", async () => {
    await expect(settlePayment(mockContract("broadcast-throw"), payment, FAST_FAIL)).rejects.toBeInstanceOf(SettlementError);
  });

  it("retries a transient broadcast failure and succeeds", async () => {
    const result = await settlePayment(mockContract("success", 1), payment, { attempts: 2, baseDelayMs: 0 });
    expect(result.txHash).toBe("0xabc123");
  });

  it("gives up after exhausting all retry attempts", async () => {
    await expect(settlePayment(mockContract("success", 5), payment, { attempts: 2, baseDelayMs: 0 })).rejects.toBeInstanceOf(SettlementError);
  });
});
