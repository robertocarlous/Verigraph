// Test-only fixtures shaped like the documented `dex-history` wire fields.
import type { TxRecord } from "../../src/types.js";

function tx(type: TxRecord["type"], time: number, valueUsd: number, marketCap: number, price: number): TxRecord {
  return {
    type,
    chainIndex: "1952",
    tokenContractAddress: "0xTOKEN0000000000000000000000000000000001",
    tokenSymbol: "DEMO",
    valueUsd: valueUsd.toFixed(2),
    amount: (valueUsd / price).toFixed(4),
    price: price.toFixed(4),
    marketCap: marketCap.toFixed(2),
    pnlUsd: "0",
    time: String(time),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse("2026-01-01T00:00:00Z");

/** Irregular cadence, varied prices/marketCap — organic trading. */
export const organicTxHistory: TxRecord[] = [
  tx("1", BASE, 120, 500_000, 1.2),
  tx("2", BASE + 2.3 * DAY, 80, 520_000, 1.25),
  tx("1", BASE + 5.1 * DAY, 200, 480_000, 1.1),
  tx("3", BASE + 9.7 * DAY, 50, 510_000, 1.22),
  tx("2", BASE + 14.2 * DAY, 150, 495_000, 1.18),
  tx("4", BASE + 20.9 * DAY, 60, 505_000, 1.19),
];

/** Tight, regular cadence; near-identical Transfer In/Out values round-tripping; flat marketCap. */
const HOUR = 60 * 60 * 1000;
export const collusiveTxHistory: TxRecord[] = [
  tx("3", BASE, 100, 500_000, 1.0),
  tx("4", BASE + 1 * HOUR, 99.5, 500_000, 1.0),
  tx("3", BASE + 2 * HOUR, 100, 500_000, 1.0),
  tx("4", BASE + 3 * HOUR, 99.8, 500_000, 1.0),
  tx("3", BASE + 4 * HOUR, 100.2, 500_000, 1.0),
  tx("4", BASE + 5 * HOUR, 100, 500_000, 1.0),
  tx("1", BASE + 6 * HOUR, 100, 500_000, 1.0),
  tx("2", BASE + 7 * HOUR, 100, 500_000, 1.0),
];
