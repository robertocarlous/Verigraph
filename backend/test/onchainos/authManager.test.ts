import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLoggedIn, getWalletStatus } from "../../src/onchainos/authManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(__dirname, "..", "fixtures", "fake-onchainos-cli.cjs");

describe("authManager (against a fake onchainos binary)", () => {
  beforeEach(() => {
    process.env.ONCHAINOS_CLI_BIN = FAKE_CLI;
    delete process.env.FAKE_ONCHAINOS_LOGGED_IN;
  });
  afterEach(() => {
    delete process.env.ONCHAINOS_CLI_BIN;
    delete process.env.FAKE_ONCHAINOS_LOGGED_IN;
  });

  it("reports not-logged-in status", async () => {
    const status = await getWalletStatus();
    expect(status.loggedIn).toBe(false);
  });

  it("ensureLoggedIn is a no-op when already logged in", async () => {
    process.env.FAKE_ONCHAINOS_LOGGED_IN = "true";
    const status = await ensureLoggedIn();
    expect(status.loggedIn).toBe(true);
    expect(status.loginType).toBe("ak");
  });

  // Our fake CLI's `wallet login` never flips FAKE_ONCHAINOS_LOGGED_IN itself
  // (a real CLI would actually establish a session as a side effect), so this
  // exercises the failure path: login runs, status is re-checked, still not
  // logged in -> ensureLoggedIn must surface a clear error rather than hang
  // or silently proceed unauthenticated.
  it("surfaces a clear error when headless login does not result in a session", async () => {
    await expect(ensureLoggedIn()).rejects.toThrow(/Headless AK login/);
  });
});
