// Thin subprocess wrapper around OKX's official `onchainos` Rust CLI binary,
// used for everything that needs a logged-in session: agent identity
// resolution, reputation/feedback lookups, and (from agent/ scripts) wallet
// and task-marketplace operations. See authManager.ts for login/session
// lifecycle — this module only knows how to run one already-authenticated
// command and parse its `--format json` output.
//
// Calls are serialized behind a mutex (the CLI's own token refresh isn't
// designed for concurrent invocations racing each other) and identity/
// feedback lookups are cached briefly to keep the hot request path cheap
// despite the per-call subprocess-spawn cost.

import { spawn } from "node:child_process";
import { optionalEnv } from "../env.js";
import type { ResolvedAgent, ReviewRecord } from "../types.js";
import { TtlCache } from "./ttlCache.js";

export class CliError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "CliError";
  }
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const cliMutex = new Mutex();
const identityCache = new TtlCache<unknown>(30_000);

export interface CliRunOptions {
  timeoutMs?: number;
}

// Confirmed against the real installed binary (v4.2.2): there is NO `--format
// json` flag — JSON is simply the default output, wrapped in an envelope:
// `{"ok":true,"data":{...}}` (exit 0) or `{"ok":false,"error":"..."}` (exit 1,
// but still valid JSON on stdout, not stderr). The skill docs' "append
// --format json" instruction does not apply to this CLI surface.
function unwrapCliEnvelope(parsed: unknown, args: string[], stdout: string, stderr: string, code: number | null): unknown {
  if (parsed && typeof parsed === "object" && "ok" in parsed) {
    const envelope = parsed as { ok: boolean; data?: unknown; error?: string };
    if (envelope.ok) return envelope.data ?? null;
    throw new CliError(`onchainos ${args.join(" ")} failed: ${envelope.error ?? "unknown error"}`, stdout, stderr, code);
  }
  return parsed; // defensive: some subcommand may not follow the {ok,data} envelope
}

function execCli(args: string[], options: CliRunOptions): Promise<unknown> {
  const cliBin = optionalEnv("ONCHAINOS_CLI_BIN", "onchainos");

  return new Promise((resolve, reject) => {
    const child = spawn(cliBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
      },
      options.timeoutMs ?? 30_000,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new CliError(`failed to spawn "${cliBin}": ${err.message}`, stdout, stderr, null));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed) {
        // No JSON on stdout at all (e.g. a genuine crash) — this is only ever
        // a hard failure, regardless of exit code.
        reject(new CliError(`onchainos ${args.join(" ")} produced no output (exit ${code}): ${stderr}`, stdout, stderr, code));
        return;
      }
      let parsed: unknown;
      try {
        // Fast path: the common case is a single JSON object on stdout.
        parsed = JSON.parse(trimmed);
      } catch {
        // Confirmed live in production: on a fresh session (e.g. a container's
        // first-ever invocation, nothing yet persisted to ONCHAINOS_HOME), the
        // CLI can implicitly re-authenticate as a side effect of running the
        // requested command, and prints BOTH the login-result JSON line AND
        // the actual command's result JSON line to stdout, newline-delimited.
        // The requested command's own result is always the LAST line.
        const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
        const lastLine = lines[lines.length - 1];
        try {
          parsed = lastLine ? JSON.parse(lastLine) : undefined;
        } catch (err) {
          reject(new CliError(`failed to parse CLI JSON output: ${(err as Error).message}\n${trimmed}`, stdout, stderr, code));
          return;
        }
        if (parsed === undefined) {
          reject(new CliError(`failed to parse CLI JSON output (no lines found)\n${trimmed}`, stdout, stderr, code));
          return;
        }
      }
      try {
        resolve(unwrapCliEnvelope(parsed, args, stdout, stderr, code));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Runs an `onchainos` subcommand, serialized against concurrent CLI invocations. */
export async function runCli(args: string[], options: CliRunOptions = {}): Promise<unknown> {
  return cliMutex.run(() => execCli(args, options));
}

// ── Field-tolerant normalizers ──────────────────────────────────────────
// The skill docs describe the CLI's *rendered prose* output, not the exact
// `--format json` key casing. Until this is verified against a real
// credentialed run, accept common camelCase/snake_case variants defensively
// rather than assuming one — see README "Verifying against real OnchainOS
// data" for the follow-up to lock this down.

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `time` is a numeric ms epoch on the wire, not an ISO string — normalize to ISO so every
 * downstream consumer (reputationGraph's `parseDate` uses `new Date(d).getTime()`) can rely
 * on a parseable string uniformly, regardless of which field/type the CLI happened to use. */
function asIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const asNum = Number(value);
    // A numeric string here is an epoch ms value, not a year — `new Date("173...")` would
    // otherwise silently parse to Invalid Date.
    if (/^\d+$/.test(value) && Number.isFinite(asNum)) return new Date(asNum).toISOString();
    return value;
  }
  return undefined;
}

export function normalizeReviewRecord(raw: Record<string, unknown>): ReviewRecord {
  // Confirmed live: `agent feedback-list` gives the raw wire score on a 0-100
  // scale via `value`/`valueString` — the identity-reputation.md doc's "CLI
  // converts wire scores back to 0.00-5.00 stars" only applies to the CLI's
  // own *prose* rendering, not its JSON output. Divide by 20 ourselves.
  const rawScore = pick(raw, "value", "valueString");
  const score =
    rawScore !== undefined
      ? (asNumber(rawScore) ?? 0) / 20
      : asNumber(pick(raw, "score", "rating", "stars")) ?? 0;

  return {
    // Confirmed live: reviews carry `reviewerAddress` (a wallet address), not an
    // agentId — there is no direct reviewer agentId field on this endpoint.
    // Reciprocity checking (which needs to call feedback-list on the reviewer's
    // own agentId) will best-effort fail closed for address-only reviewers —
    // concentration/burst/duplicate-text/extremity signals still work fine
    // using the address as the grouping key.
    reviewerId: asString(pick(raw, "reviewerId", "reviewer_id", "reviewerAgentId", "reviewerAddress")) ?? "",
    reviewerRole: asString(pick(raw, "reviewerRole", "reviewer_role", "role")),
    reviewerName: asString(pick(raw, "reviewerName", "reviewer_name", "agentName", "name")),
    score,
    date: asIsoDate(pick(raw, "date", "createdAt", "created_at", "time")) ?? "",
    taskHash: asString(pick(raw, "taskHash", "task_hash", "jobHash", "job_hash", "id")),
    description: asString(pick(raw, "description", "comment", "content")) ?? "",
  };
}

export function normalizeAgentRecord(raw: Record<string, unknown>): ResolvedAgent {
  return {
    agentId: asString(pick(raw, "agentId", "agent_id", "id")),
    // Confirmed live: `agent get-agents` returns `agentWalletAddress` (and a
    // matching `ownerAddress`) — NOT `walletAddress`. `agent search` returns
    // neither; it only has `communicationAddress`, which is a fallback (used
    // for A2A messaging, not necessarily the funds-holding wallet) — good
    // enough to resolve an identifier when get-agents isn't also called.
    walletAddress: asString(pick(raw, "agentWalletAddress", "ownerAddress", "communicationAddress", "walletAddress", "wallet_address", "address")) ?? "",
    role: asString(pick(raw, "roleLabel", "role")),
    name: asString(pick(raw, "name", "agentName", "agent_name")),
  };
}

function extractList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const list = pick(obj, "items", "list", "data");
    if (Array.isArray(list)) return list as Record<string, unknown>[];
  }
  return [];
}

// ── High-level, cached operations ───────────────────────────────────────

export async function getAgentsByIds(agentIds: string[]): Promise<ResolvedAgent[]> {
  const key = `get-agents:${[...agentIds].sort().join(",")}`;
  const raw = await identityCache.getOrCompute(key, () => runCli(["agent", "get-agents", "--agent-ids", agentIds.join(",")]));
  return extractList(raw).map(normalizeAgentRecord);
}

export async function searchAgents(query: string, pageSize = 5): Promise<ResolvedAgent[]> {
  const key = `search:${query}:${pageSize}`;
  const raw = await identityCache.getOrCompute(key, () =>
    runCli(["agent", "search", "--query", query, "--page-size", String(pageSize)]),
  );
  return extractList(raw).map(normalizeAgentRecord);
}

export async function feedbackList(agentId: string, pageSize = 50): Promise<ReviewRecord[]> {
  const key = `feedback-list:${agentId}:${pageSize}`;
  const raw = await identityCache.getOrCompute(key, () =>
    runCli(["agent", "feedback-list", "--agent-id", agentId, "--page-size", String(pageSize)]),
  );
  return extractList(raw).map(normalizeReviewRecord);
}
