# Why there's no `taskMarketplaceLoop.ts` script

The original plan (see `/Users/mac/.claude/plans/partitioned-pondering-teacup.md`)
called for the self-play harness to prioritize a task-marketplace loop (publish →
apply → accept → deliver → rate, repeated with roles swapped) over plain transfers,
since that's what produces fabricated *ratings* — the primary detection signal.

While implementing it, `task-cli-reference.md` and `task-core.md` (from the
research clone of `github.com/okx/onchainos-skills`) turned up a hard blocker:

- `agent apply` is explicitly documented as **"System-event-triggered only; never
  invoke manually."**
- The intended driver for every step is `agent next-action --role <role> --agentId
  <id> --message '<event JSON>'`, whose output is a **script string the caller must
  execute verbatim** ("🛑 Strictly execute the returned script").
- Those `--message` events arrive as pushed **envelopes** through OKX's own
  agent-to-agent communication runtime (`okx-a2a daemon`, per
  `chat-comm-init.md`) — not something a plain polling loop can synthesize. The
  architecture assumes an LLM agent (Claude Code or similar) sitting in the loop,
  interpreting each pushed envelope and running whatever `next-action` returns.

In other words: this flow isn't a deterministic API you script against — it's
designed to be driven by an actual agent session with the `okx-a2a` runtime
active. Writing a Node script that hand-sequences `create-task` → `apply` →
`confirm-accept` → `deliver` → `complete` → `feedback-submit` myself would
directly contradict the "never invoke manually" warning and would be untestable
here (no credentials, no daemon, no live backend) — i.e., I'd be shipping code
I have no basis to believe is correct.

## What to do instead (once you have credentials)

`transferLoop.ts` (the shipped, tested harness) already produces a real,
verifiable on-chain collusive pattern and is enough to demo the detector end to
end. If you also want the higher-fidelity rating-collusion demo the PRD
describes, do it the way OKX actually designed it to be driven — with two real
agent sessions, not a custom script:

1. Install the `onchainos-skills` plugin in two separate Claude Code (or other
   OKX-skill-compatible agent) sessions/workspaces, each logged in with its own
   OKX AK credentials (`WALLET_A_*` / `WALLET_B_*` from `.env.example`) and its
   own `ONCHAINOS_HOME`.
2. In session A, prompt: *"Register an ASP agent identity, then publish a task
   designating [Wallet B's agentId] as the provider, nominal budget."*
3. In session B, prompt: *"Apply for and deliver the task from [Wallet A's
   agentId], then wait for completion."*
4. Back in session A: *"Accept the delivery and leave a 5-star review."*
5. Swap roles and repeat a few times in quick succession.
6. Run `POST /v1/integrity-check` against either agentId — `reputationGraph.ts`
   is built and unit-tested (see `test/detection/reputationGraph.test.ts`) to
   flag exactly this pattern: reciprocal review pairs swapped within a tight
   time window, reviewer concentration, and near-duplicate review text.

This isn't a gap in the detector — `reputationGraph.ts` is fully implemented and
tested against fixtures shaped like this exact scenario. It's specifically the
*automation* of generating this pattern that requires the real agent-session
architecture rather than a standalone script.
