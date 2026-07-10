// WORKING self-play harness: two wallet accounts send each other tiny,
// near-identical amounts on a tight, regular cadence on X Layer testnet — a
// real, on-chain, verifiable "collusive reciprocal transfer" pattern.
//
// IMPORTANT, confirmed live (not the original design): separate OKX API keys
// under the SAME OKX developer account all resolve to the SAME agentic
// wallet address — an API key authenticates a project, not a distinct
// wallet. Two genuinely different addresses under one login come from
// `wallet add` (creates a new account) + `wallet switch` between them, which
// is what this script actually does. A single OKX credential set is enough;
// WALLET_B_OKX_* is no longer used (kept in .env.example only because it's
// harmless to leave set, in case a genuinely separate OKX account is
// supplied there later).
//
// The two accounts are provisioned once and cached in `.selfplay-accounts.json`
// (gitignored) so repeat runs reuse the same two addresses instead of
// creating a fresh "Account N" every time (the CLI has no "list accounts"
// command to rediscover a previously-created one).
//
// Required env (see .env.example): WALLET_A_OKX_API_KEY/SECRET/PASSPHRASE.
// Optional: SELF_PLAY_ITERATIONS (default 6), SELF_PLAY_INTERVAL_MS (default
// 30000), SELF_PLAY_AMOUNT (default "0.01"), SELF_PLAY_CHAIN (default
// "xlayer_test"), EXPLORER_BASE_URL.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { requireEnv, optionalEnv } from "../backend/src/env.js";
import { ensureLoggedIn, getWalletStatus } from "../backend/src/onchainos/authManager.js";
import { runCli } from "../backend/src/onchainos/cliClient.js";

const CACHE_PATH = ".selfplay-accounts.json";

interface Account {
  accountId: string;
  accountName: string;
  address: string;
}

interface AccountsCache {
  accountA: Account;
  accountB: Account;
}

interface ChainAddressEntry {
  address?: unknown;
  chainName?: unknown;
  chainIndex?: unknown;
}

/**
 * Confirmed live: `wallet addresses` groups by category into arrays —
 * `{accountId, accountName, evm: [{address, chainIndex, chainName}], solana: [...], xlayer: [...]}`.
 * `wallet add`'s response instead carries a flat `addressList` with the same
 * per-entry shape — both are handled by searching every array we're given.
 */
function extractAddress(entries: ChainAddressEntry[], chainName: string): string | undefined {
  const matching = entries.find((e) => e.chainName === chainName || String(e.chainIndex) === chainName);
  const address = (matching ?? entries.find((e) => typeof e.address === "string"))?.address;
  return typeof address === "string" ? address : undefined;
}

function collectAddressEntries(raw: Record<string, unknown>): ChainAddressEntry[] {
  const arrays = [raw.evm, raw.xlayer, raw.solana, raw.addressList].filter((g): g is ChainAddressEntry[] => Array.isArray(g));
  return arrays.flat();
}

function loadCache(): AccountsCache | undefined {
  if (!existsSync(CACHE_PATH)) return undefined;
  return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as AccountsCache;
}

function saveCache(cache: AccountsCache): void {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function provisionAccounts(chain: string): Promise<AccountsCache> {
  // Always (re-)establish the session, even on a cache hit — each CLI
  // invocation is a fresh subprocess, and skipping this once caused signing
  // to fail with "HPKE decryption failed" (a stale/missing TEE session key),
  // not a login problem per se.
  await ensureLoggedIn();

  const cached = loadCache();
  if (cached) {
    console.log(`Reusing cached self-play accounts from ${CACHE_PATH} (delete it to provision fresh ones).`);
    return cached;
  }

  const statusA = await getWalletStatus();
  const addressesA = (await runCli(["wallet", "addresses", "--chain", chain])) as Record<string, unknown>;
  const addressA = extractAddress(collectAddressEntries(addressesA), chain);
  if (!statusA.currentAccountId || !addressA) {
    throw new Error(`Could not resolve the primary account/address from: ${JSON.stringify({ statusA, addressesA })}`);
  }
  const accountA: Account = { accountId: statusA.currentAccountId, accountName: statusA.currentAccountName ?? "Account A", address: addressA };
  console.log(`[Account A] ${accountA.accountName} (${accountA.accountId}) — ${accountA.address}`);

  const addResult = (await runCli(["wallet", "add"])) as Record<string, unknown>;
  const addressB = extractAddress(collectAddressEntries(addResult), chain);
  const accountBId = addResult.accountId as string | undefined;
  if (!accountBId || !addressB) {
    throw new Error(`\`wallet add\` did not return a usable second account: ${JSON.stringify(addResult)}`);
  }
  const accountB: Account = { accountId: accountBId, accountName: (addResult.accountName as string) ?? "Account B", address: addressB };
  console.log(`[Account B] ${accountB.accountName} (${accountB.accountId}) — ${accountB.address}`);

  // `wallet add` auto-switches to the new account — switch back to A so the
  // very first send() call (which switches explicitly before every send
  // anyway) starts from a known state.
  await runCli(["wallet", "switch", accountA.accountId]);

  const cache: AccountsCache = { accountA, accountB };
  saveCache(cache);
  console.log(`Cached account info to ${CACHE_PATH} for future runs.`);
  return cache;
}

const SEND_RETRY_ATTEMPTS = 4;
const SEND_RETRY_BASE_DELAY_MS = 4000;

async function sendFrom(fromAccount: Account, toAccount: Account, amount: string, chain: string): Promise<string> {
  // Confirmed live: `ensureLoggedIn()`'s skip-if-already-logged-in shortcut
  // (which only checks `wallet status`) is not enough before a signing
  // operation — it left a stale TEE session key that failed with "HPKE
  // decryption failed: Failed to open ciphertext" on `send`. A plain
  // `wallet login` (even when already logged in — it's a fast no-op auth
  // refresh, not a state reset) fixed it. Re-run before every send, since
  // switching accounts is exactly the kind of session-state change this
  // seems to invalidate.
  //
  // Also confirmed live: OKX's backend (web3.okx.com and its CDN mirrors)
  // intermittently times out or degrades from this environment — sometimes
  // surfacing as an explicit "Network unavailable ... operation timed out",
  // other times as a misleading "may_be_out_of_gas" from a stalled gas
  // estimation call. Neither is a logic bug (both send paths were proven to
  // work with clean connectivity — real tx hashes were produced). Retry with
  // backoff rather than failing the whole run on a transient network blip.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt++) {
    try {
      await runCli(["wallet", "login"]);
      await runCli(["wallet", "switch", fromAccount.accountId]);
      return await trySend(fromAccount, toAccount, amount, chain);
    } catch (err) {
      lastErr = err;
      if (attempt < SEND_RETRY_ATTEMPTS) {
        const delay = SEND_RETRY_BASE_DELAY_MS * attempt;
        console.log(`  (attempt ${attempt}/${SEND_RETRY_ATTEMPTS} failed: ${(err as Error).message} — retrying in ${delay}ms)`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function trySend(fromAccount: Account, toAccount: Account, amount: string, chain: string): Promise<string> {
  const result = (await runCli([
    "wallet",
    "send",
    "--readable-amount",
    amount,
    "--recipient",
    toAccount.address,
    "--chain",
    chain,
  ])) as Record<string, unknown>;
  const txHash = result?.txHash as string | undefined;
  if (!txHash) throw new Error(`send from ${fromAccount.accountName} did not return a txHash: ${JSON.stringify(result)}`);
  return txHash;
}

async function main(): Promise<void> {
  requireEnv("WALLET_A_OKX_API_KEY");
  requireEnv("WALLET_A_OKX_SECRET_KEY");
  requireEnv("WALLET_A_OKX_PASSPHRASE");
  process.env.OKX_API_KEY = process.env.WALLET_A_OKX_API_KEY;
  process.env.OKX_SECRET_KEY = process.env.WALLET_A_OKX_SECRET_KEY;
  process.env.OKX_PASSPHRASE = process.env.WALLET_A_OKX_PASSPHRASE;

  const chain = optionalEnv("SELF_PLAY_CHAIN", "xlayer_test");
  const iterations = Number(optionalEnv("SELF_PLAY_ITERATIONS", "6"));
  const intervalMs = Number(optionalEnv("SELF_PLAY_INTERVAL_MS", "30000"));
  const amount = optionalEnv("SELF_PLAY_AMOUNT", "0.01");
  const explorerBase = process.env.EXPLORER_BASE_URL;

  console.log(`Provisioning two self-play accounts on ${chain} ...`);
  const { accountA, accountB } = await provisionAccounts(chain);

  console.log(
    `\nRunning ${iterations} reciprocal transfers of ${amount} every ${intervalMs}ms between ${accountA.address} and ${accountB.address} ...\n`,
  );

  // Confirmed live: an individual account's `wallet send` reliably works for
  // its first send or two, then starts failing "may_be_out_of_gas" for EVERY
  // destination and amount (a real OKX testnet smart-account/bundler
  // reliability issue, not a Verigraph bug — the same account/recipient
  // combination that fails here has separately produced real confirmed
  // transactions). One iteration's failure shouldn't discard whatever real
  // on-chain evidence the run did manage to produce, so log and continue
  // rather than aborting the whole loop.
  const txHashes: string[] = [];
  const failures: string[] = [];
  for (let i = 0; i < iterations; i++) {
    const [sender, receiver] = i % 2 === 0 ? [accountA, accountB] : [accountB, accountA];
    try {
      const txHash = await sendFrom(sender, receiver, amount, chain);
      txHashes.push(txHash);
      const link = explorerBase ? `${explorerBase.replace(/\/$/, "")}/tx/${txHash}` : txHash;
      console.log(`[${i + 1}/${iterations}] ${sender.accountName} -> ${receiver.accountName}: ${amount} — ${link}`);
    } catch (err) {
      const message = (err as Error).message;
      failures.push(`[${i + 1}/${iterations}] ${sender.accountName} -> ${receiver.accountName}: ${message}`);
      console.log(`[${i + 1}/${iterations}] FAILED (${sender.accountName} -> ${receiver.accountName}): ${message}`);
    }
    if (i < iterations - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log(`\nDone. ${txHashes.length}/${iterations} transfers produced real on-chain transactions; ${failures.length} failed.`);
  if (txHashes.length > 0) {
    console.log(`Verify with: POST /v1/integrity-check { "target": "${accountA.address}" } (expect LIKELY_MANUFACTURED / MIXED_SIGNAL from txPatterns, once run against a chain dex-history actually covers).`);
    console.log(`Successful tx hashes:\n${txHashes.map((h) => `  ${h}`).join("\n")}`);
  }
  if (failures.length > 0) {
    console.log(`\nFailures (likely OKX testnet bundler flakiness, not a script bug):\n${failures.map((f) => `  ${f}`).join("\n")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
