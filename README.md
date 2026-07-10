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
  registerAsp.ts         # one-time: registers the ASP identity + lists it on OKX.AI
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
assets/
  avatar.svg / avatar.png  # ASP marketplace avatar (shield + connected-node graph),
                           #   hand-authored SVG rasterized with sharp-cli — no AI image tool used
Dockerfile / .dockerignore  # production image for deployment (see "Deployment" below);
                            #   the running server never reads the Hardhat artifact
                            #   (config.ts hardcodes its own minimal ERC-20 ABI), so this
                            #   image only needs Node + the compiled server + the real
                            #   `onchainos` CLI binary — not Hardhat/contract compilation
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

## Deployment

OKX.AI's ASP registration flow **rejects** `http://`, `localhost`, `127.0.0.1`,
private IPs, and mock URLs for a service `endpoint` (confirmed live — see
below) — it must be a real, publicly reachable `https://` URL before you can
register at all. The included `Dockerfile` builds a production image
containing the compiled server plus the real `onchainos` CLI binary (see
"Project layout" above for why Hardhat/contract artifacts aren't needed in
it). Deployed and verified live on [Railway](https://railway.app):

```bash
railway login          # or: use an existing authenticated session
railway init --name verigraph
railway up -d -y --service verigraph
railway variable set "OKX_API_KEY=..." --skip-deploys
railway variable set "OKX_SECRET_KEY=..." --skip-deploys
railway variable set "OKX_PASSPHRASE=..." --skip-deploys
railway variable set "XLAYER_TESTNET_RPC_URL=..." --skip-deploys
railway variable set "RELAYER_PRIVATE_KEY=..." --skip-deploys
railway variable set "SERVICE_WALLET_ADDRESS=..." --skip-deploys
railway variable set "DEMO_TOKEN_ADDRESS=..." --skip-deploys   # from .deployed-token.json
railway variable set "CHAIN_INDEX=196"          # last one triggers the deploy
railway domain          # generates the public HTTPS URL
```

Any Dockerfile-based host works the same way (Render, Fly.io, a VPS) — the
image only needs the env vars above plus outbound network access to the OKX
API and the X Layer RPC.

**Verified live** (not just health-checked): a full real request against the
deployed public URL — `POST /v1/integrity-check` for real production OKX.AI
agent **#3118 ("CoinWM Open API")** → real `402` → real signed EIP-3009
payment → real on-chain settlement on X Layer testnet → real `200` with a
full integrity report (`ORGANIC`, 100/100, backed by a real fetched review
and real mainnet `dex-history`).

**Real bug found and fixed via this deployment**: the first live run against
a *fresh* container (nothing yet persisted to `ONCHAINOS_HOME`) took the
payment successfully but then **500'd** — `cliClient.ts`'s JSON parser
assumed a single JSON object on stdout, but a fresh session makes the
`onchainos` CLI implicitly re-authenticate as a side effect of the requested
command, printing **two** newline-delimited JSON objects (the login result,
then the real result) to stdout in that one invocation. Fixed by falling
back to parsing the *last* line when whole-output parsing fails; regression-
tested in `backend/test/onchainos/cliClient.test.ts` (`multiline` case in
the fake-CLI fixture).

## Listing on OKX.AI (ASP marketplace registration)

`npm run asp:register` (`agent/registerAsp.ts`) drives the real
`pre-check` → consent → avatar upload → `validate-listing` → `create` →
`activate` flow end to end. Required env: `ASP_NAME`, `ASP_DESCRIPTION`,
`ASP_AVATAR_PATH`, `ASP_SERVICE_NAME`, `ASP_SERVICE_DESCRIPTION` (must be
**two lines** — a capability summary, then what the caller must provide —
or `validate-listing` blocks with code `D1`), `ASP_SERVICE_FEE`,
`ASP_SERVICE_ENDPOINT` (real `https://`, ≤512 chars). The script stops and
prints the consent terms verbatim on a first-time wallet rather than
auto-accepting — re-run with the printed `ASP_CONSENT_KEY` once a human has
actually agreed to them.

**Real, previously-undocumented bugs found registering the live identity**
(none of these are in `identity-register.md` or any `--help` short text —
only the full `onchainos agent create --help` output has the truth):

1. **Service JSON keys are camelCase `serviceName` / `serviceDescription` /
   `serviceType`** — not `name`/`description`/`type` (what the skill docs'
   prose field labels implied), and not the lowercase-concatenated
   `servicedescription`/`servicetype` shown in `validate-listing`'s *own*
   error-message example either (that example is itself wrong/misleading).
   Confirmed correct against `onchainos agent create --help`'s full option
   description, the actual authoritative source.
2. **`agent activate` requires `--preferred-language`** — omitting it fails
   with a plain clap argument error, not a business-logic error.
3. **`activate` needs OKX's A2A communication runtime installed and ready**,
   or it fails with `"A2A communication is not ready... okx-a2a is not
   installed"`. Fix: `npm i -g @okxweb3/a2a-node && okx-a2a doctor --fix`.
   **Heads up**: this installs a persistent background daemon with OS
   autostart (macOS: a `launchd` plist at
   `~/Library/LaunchAgents/com.okx.a2a.plist`) — it's what lets the ASP
   identity handle agent-to-agent messages, but it now starts automatically
   on login. Disable with `launchctl unload
   ~/Library/LaunchAgents/com.okx.a2a.plist` if you don't want that.
4. **A successful `activate` call submits the listing for OKX's internal
   review — it does not make it immediately publicly listed.** The response
   shape is `{activate: {success: false, approvalStatus: 1}, submitApproval:
   {success: true, approvalStatus: 2}}`; `success: false` here is expected,
   not a failure. Check real status any time with:
   ```bash
   onchainos agent get-agents --agent-ids <id>
   ```
   which reports `approvalLabel` (e.g. `"Listing under review"`),
   `approvalRemark` (an automated quality-review note), and `statusLabel`
   (`"not listed"` until OKX approves it — this is expected, external, and
   asynchronous, exactly matching the hackathon rule "must pass OKX AI's
   internal review and go live").

**Live status**: registered as **agent #5011 ("Verigraph")** — real avatar
uploaded to OKX's CDN, `approvalRemark: "AI quality review suggested pass"`,
submitted for review. `serviceList` came back empty on the last status
check despite the service being submitted with `create` — worth
re-verifying once OKX's review finishes; may just be pending-until-approved
rather than a bug.

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
- **Real self-play wallet-topology discovery**: separate OKX API keys created
  under the *same* OKX developer account all resolve to the **same** agentic
  wallet address — an API key authenticates a project, not a distinct
  wallet. Two genuinely different addresses under one login come from
  `wallet add` (creates a new account) + `wallet switch` between them, which
  is what `agent/transferLoop.ts` actually does; `WALLET_B_OKX_*` env vars
  are unused as a result (kept only in case a genuinely separate OKX account
  is supplied there later). Provisioned accounts are cached in
  `.selfplay-accounts.json` (gitignored) so repeat runs reuse the same two
  addresses instead of creating a fresh "Account N" every time.
- **`ensureLoggedIn()`'s skip-if-already-logged-in shortcut is not enough
  before a signing operation** — it only checks `wallet status`, which can
  leave a stale TEE session key that fails `wallet send` with `"HPKE
  decryption failed: Failed to open ciphertext"`. Fix: re-run a plain
  `wallet login` (a fast no-op auth refresh, not a state reset) immediately
  before every `send`, not just once per process. `agent/transferLoop.ts`
  does this now.
- **A given agentic-wallet account can get stuck** in a state where every
  `wallet send` fails with `Wallet API error (code=81359) ... may_be_out_of_gas`
  regardless of destination or balance (confirmed: retried with 3x the
  balance, and against multiple different recipients, same error every
  time) — while a *different* account under the same login sends
  successfully. Root cause not identified (X Layer's own bundler/paymaster
  state for that specific smart-contract account, not anything in this repo
  — balance, nonce, and session were all confirmed fine). Workaround:
  `wallet add` a fresh replacement account rather than debugging the stuck
  one further.

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
- **The task-marketplace self-play loop** (publish/apply/accept/deliver/rate)
  is documented in `agent/TASK_MARKETPLACE_LOOP.md` rather than shipped as
  a script — it turns out to require OKX's `okx-a2a` communication daemon and
  an LLM agent in the loop (not a pollable API), so a deterministic Node
  script would have been unverified guesswork. `transferLoop.ts` is the
  real, tested harness.
- **`serviceList` came back empty** on the last `agent get-agents` check for
  the live ASP identity (#5011) despite `create` having submitted a service —
  worth re-verifying once OKX's review finishes; may be pending-until-approved
  rather than a bug in how the service was submitted.

Everything resolved above (`wallet addresses` shape, `agent feedback-list` /
`get-agents` field casing, the exact ASP registration wire format) is now
**confirmed against real live runs**, not assumed from docs — and in three
cases (multi-line CLI stdout, service JSON key casing, `activate`'s required
flag + A2A dependency) the docs/`--help` text/error-message examples were
each individually wrong or incomplete in a different way. Treat any *new*
`onchainos` subcommand this repo doesn't already exercise as unverified until
you've run it for real — the pattern here was consistently "the docs describe
the intent, the real binary has its own opinions about the exact wire shape."
