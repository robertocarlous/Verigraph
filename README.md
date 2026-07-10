# Verigraph — Agent Reputation Integrity Monitor

An Agent Service Provider (ASP) for the OKX.AI Genesis Hackathon. Any agent can pay
(x402, per query) to check whether a target agent's on-chain reputation looks
organically earned or manufactured via wash-trading / wash-rating collusion
between two agents.


## How it works

1. **Resolve** — a wallet address or OKX.AI agent ID → an on-chain wallet address
   (`backend/src/server.ts` → `resolveTarget`).
2. **Gather signals**, three layers deep:
   - `backend/src/detection/reputationGraph.ts` (**primary**) — reviewer concentration,
     mutual review-swap loops, rating bursts, near-duplicate review text, score
     extremity. Runs on `agent feedback-list` data.
   - `backend/src/detection/txPatterns.ts` (**secondary**) — cadence regularity,
     value round-tripping, flat market cap despite repeated trades. Runs on
     `dex-history` for the resolved wallet.
   - `backend/src/detection/onchainCrossRef.ts` (**bridging**) — once the reputation
     graph flags a top suspect counterparty, pulls that specific pair's ERC-20
     `Transfer` logs directly from the chain via `eth_getLogs` to confirm (or
     rule out) a real, reciprocal on-chain relationship.
3. **Score** — `backend/src/detection/scorer.ts` combines all three into a 0–100
   `integrityScore` + `ORGANIC` / `MIXED_SIGNAL` / `LIKELY_MANUFACTURED` label +
   an evidence list.
4. **Charge** — the whole thing sits behind a self-facilitated x402 payment gate
   (`backend/src/x402/`): no OKX-hosted seller-side facilitator is documented, so
   Verigraph issues its own `accepts[]` challenge, verifies the buyer's EIP-3009
   signature itself, and settles on-chain via its own relayer wallet, requiring
   on-chain confirmation before serving the response.

## Project layout

Organized into exactly three code folders — `contract/`, `agent/`, `backend/` —
matching the backend-and-agent-side scope of this build, plus root-level
project tooling/config.

```
contract/
  DemoEIP3009Token.sol   # minimal ERC-20 + EIP-3009, testnet-only demo token
  deployDemoToken.ts     # deploys it to X Layer testnet, writes .deployed-token.json
agent/
  transferLoop.ts        # WORKING self-play harness (see below)
  registerAsp.ts         # one-time: registers the ASP identity + lists the service
  TASK_MARKETPLACE_LOOP.md  # why the richer rating-collusion harness isn't a script
backend/
  src/
    onchainos/           # restClient (HMAC public API), cliClient (subprocess wrapper
                          #   for session-tier CLI calls), authManager (headless login)
    detection/            # the three signal modules + scorer (pure, unit-tested)
    x402/                  # challenge / verify / settle / nonceStore / middleware
    server.ts              # Express app: POST /v1/integrity-check, /v1/pricing, /v1/health
    config.ts              # lazy config assembly — /health and /pricing work with zero creds
  test/                    # vitest — detection engine, x402, onchainos client, all offline
  test/integration/localE2E.ts  # real end-to-end check against a local Hardhat chain
hardhat.config.cjs         # kept at root (Hardhat's cwd-based config discovery);
                            #   paths.sources points at contract/
```

## Setup

```bash
npm install
npm run compile:contracts   # compiles contract/DemoEIP3009Token.sol via Hardhat
cp .env.example .env        # fill in as you go — nothing is required yet
```

### Right now, with zero credentials

```bash
npm test          # 50 tests, fully offline (detection engine + x402 crypto + fake-CLI plumbing)
npm run typecheck
npm run dev        # boots on :8402 — curl /v1/health and /v1/pricing work immediately
npx tsx backend/test/integration/localE2E.ts   # real 402->sign->pay->settle->replay-blocked
                                                # against a local Hardhat chain + the real contract
```

### Once you have OKX credentials (Developer Portal) + a funded testnet wallet

1. **Get the real X Layer testnet RPC URL** from X Layer's official docs or
   Chainlist (`chainlist.org/chain/1952`) — deliberately not hardcoded anywhere
   in this repo (OKX's own `onchainos` CLI doesn't hardcode it either; only
   mainnet is wired in their source). Set `XLAYER_TESTNET_RPC_URL`.
2. Set `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` (OKX Web3 Developer
   Portal: `web3.okx.com/onchainos/dev-portal`).
3. Install the real `onchainos` CLI (`npx skills add okx/onchainos-skills` or
   see github.com/okx/onchainos-skills) so `ensureLoggedIn()` has something to
   drive. Verify: `onchainos wallet login && onchainos wallet status` should
   show `loggedIn: true, loginType: "ak"` with no OTP prompt.
4. `npm run deploy:demo-token` (needs `DEMO_TOKEN_DEPLOYER_PRIVATE_KEY`, a
   funded testnet key — get testnet OKB from `web3.okx.com/xlayer/faucet`) —
   writes `contract/.deployed-token.json`.
5. Set `RELAYER_PRIVATE_KEY` and `SERVICE_WALLET_ADDRESS`.
6. `npm run dev` — `/v1/health` should now report `paymentConfigured: true`.
7. `npm run selfplay:transfers` (needs two separate OKX AK credential sets,
   `WALLET_A_*` / `WALLET_B_*`) — produces a real, on-chain, verifiable
   reciprocal-transfer pattern and prints tx hashes. Runs on X Layer **testnet**
   by default (`SELF_PLAY_CHAIN=xlayer_test`), which is safe but means
   `txPatterns.ts` won't see it (see "Confirmed live" above — `dex-history` is
   mainnet-only). To actually exercise `txPatterns` end-to-end, set
   `SELF_PLAY_CHAIN=xlayer` and fund both wallets with a small real balance
   first — a deliberate choice given real (if tiny) value is then in motion.
8. `POST /v1/integrity-check { "target": "<the wallet you want to check>" }`
   (paid via x402) — if checking against real self-play evidence, this must be
   a **mainnet** address for `txPatterns` to have anything to look at.
9. `npm run asp:register` (needs `ASP_*` vars — name, description, avatar image
   path, service pricing) to actually list Verigraph on OKX.AI. This is a real,
   on-chain, semi-irreversible action — it prints consent terms and QA findings
   and stops for you to review rather than auto-confirming.

## Confirmed live (real OKX credentials + real X Layer testnet)

- HMAC signing + `dex-history` field mapping (`TxRecord`) verified byte-for-byte
  correct against the real API — built from docs alone, zero adjustment needed
  once real data came back.
- Full x402 flow — 402 → sign → pay → on-chain settlement → confirmed → replay
  blocked with 409 — run for real against a deployed `DemoEIP3009Token` on X
  Layer testnet, not just against a local Hardhat chain.
- **Important, testnet-only-affects-this finding**: `dex-history` rejects
  `chainIndex "1952"` (X Layer testnet) with `{code: "51000", msg: "chain id
  param error"}` — confirmed live. It's mainnet-only; there's no real DEX
  market data on a testnet. `CHAIN_INDEX` now defaults to `"196"` (mainnet)
  accordingly. **Consequence**: `transferLoop.ts`'s testnet transfers are
  invisible to `txPatterns.ts`, since that signal only ever queries mainnet.
  The x402 payment rail and self-play harness both intentionally run on
  testnet (no real value at risk); a target agent's actual reputation data
  only exists on mainnet. Demoing `txPatterns` end-to-end against a *self-play*
  wallet would require running the transfer loop on mainnet with a small real
  balance instead of testnet — a real trade-off (tiny real value moved between
  your own two wallets, gas-free) worth deciding deliberately rather than
  defaulting into.

## Honest caveats — verify these before relying on them

Built by reading OKX's real `onchainos` CLI source (`github.com/okx/onchainos-skills`
on GitHub) directly, not by guessing — but a few things could only be confirmed
once the real `onchainos` CLI binary is installed:

- **`agent feedback-list` / `agent get-agents` JSON field casing**: the skill
  docs describe the CLI's *rendered prose* output, not the exact `--format
  json` key names. `backend/src/onchainos/cliClient.ts`'s `normalizeReviewRecord` /
  `normalizeAgentRecord` accept common camelCase/snake_case variants
  defensively. If a real run shows different keys, add them to the `pick(...)`
  candidate lists there.
- **`wallet addresses` response shape**: same caveat — `extractAddress` in
  `agent/transferLoop.ts` is written defensively for the same reason.
- **The task-marketplace self-play loop** (publish/apply/accept/deliver/rate)
  is documented in `agent/TASK_MARKETPLACE_LOOP.md` rather than shipped as
  a script — it turns out to require OKX's `okx-a2a` communication daemon and
  an LLM agent in the loop (not a pollable API), so a deterministic Node
  script would have been unverified guesswork. `transferLoop.ts` is the
  real, tested harness.

Everything else — the HMAC signing scheme, the `dex-history` endpoint and its
fields, X Layer chain indices, the x402 `accepts[]`/`PAYMENT-REQUIRED`/`X-PAYMENT`
wire format, `wallet login`'s headless AK mode, `wallet send`'s flags, and the
full `agent create`/`validate-listing`/`pre-check` ASP registration flow — was
read directly from OKX's CLI source and skill docs, not guessed.
