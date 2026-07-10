// Owns the `onchainos` CLI's login/session lifecycle so cliClient.ts callers
// never think about auth. `onchainos wallet login` with NO email argument
// does silent, headless API-Key login straight from OKX_API_KEY/
// OKX_SECRET_KEY/OKX_PASSPHRASE — confirmed in wallet-cli-reference.md — so
// this never needs an interactive OTP, which was the key risk flagged during
// planning.

import { runCli } from "./cliClient.js";

export interface WalletStatus {
  loggedIn: boolean;
  loginType?: "email" | "ak";
  currentAccountId?: string;
  currentAccountName?: string;
  email?: string;
}

function normalizeStatus(raw: unknown): WalletStatus {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    loggedIn: Boolean(obj.loggedIn),
    loginType: obj.loginType as WalletStatus["loginType"],
    currentAccountId: obj.currentAccountId as string | undefined,
    currentAccountName: obj.currentAccountName as string | undefined,
    email: obj.email as string | undefined,
  };
}

export async function getWalletStatus(): Promise<WalletStatus> {
  return normalizeStatus(await runCli(["wallet", "status"]));
}

/** Idempotent: no-ops if already logged in, otherwise runs headless AK login. */
export async function ensureLoggedIn(): Promise<WalletStatus> {
  const status = await getWalletStatus();
  if (status.loggedIn) return status;

  await runCli(["wallet", "login"]); // no email arg -> silent AK login from env creds

  const after = await getWalletStatus();
  if (!after.loggedIn) {
    throw new Error(
      "Headless AK login did not result in a logged-in session. Check OKX_API_KEY/OKX_SECRET_KEY/OKX_PASSPHRASE " +
        "and that the `onchainos` CLI binary is installed and on PATH (or ONCHAINOS_CLI_BIN points at it).",
    );
  }
  return after;
}

export interface SessionWatchdogHandle {
  stop(): void;
}

/**
 * Periodically re-checks/re-establishes the session so a dropped session
 * degrades gracefully (logged via onError) instead of silently breaking
 * agent-identity/feedback lookups. Does not throw into the caller.
 */
export function startSessionWatchdog(intervalMs = 10 * 60 * 1000, onError: (err: unknown) => void = console.error): SessionWatchdogHandle {
  const timer = setInterval(() => {
    ensureLoggedIn().catch(onError);
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
