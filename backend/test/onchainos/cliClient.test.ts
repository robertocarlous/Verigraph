import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, feedbackList, getAgentsByIds, runCli, searchAgents } from "../../src/onchainos/cliClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(__dirname, "..", "fixtures", "fake-onchainos-cli.cjs");

describe("cliClient (against a fake onchainos binary)", () => {
  beforeEach(() => {
    process.env.ONCHAINOS_CLI_BIN = FAKE_CLI;
  });
  afterEach(() => {
    delete process.env.ONCHAINOS_CLI_BIN;
    delete process.env.FAKE_ONCHAINOS_LOGGED_IN;
  });

  it("parses successful JSON output", async () => {
    process.env.FAKE_ONCHAINOS_LOGGED_IN = "true";
    const result = (await runCli(["wallet", "status"])) as { loggedIn: boolean };
    expect(result.loggedIn).toBe(true);
  });

  it("throws CliError when the process crashes with no JSON output at all", async () => {
    try {
      await runCli(["fail"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toMatch(/simulated CLI crash/);
    }
  });

  it("surfaces a structured {ok:false, error} business failure as a CliError with that message", async () => {
    try {
      await runCli(["businessfail"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toMatch(/simulated business error/);
    }
  });

  it("throws CliError on malformed JSON", async () => {
    await expect(runCli(["badjson"])).rejects.toBeInstanceOf(CliError);
  });

  it("takes the LAST JSON line when the CLI prints an implicit login line before the real result (confirmed live in production)", async () => {
    const result = (await runCli(["multiline"])) as { real: string };
    expect(result.real).toBe("result");
  });

  it("throws a clear CliError when the binary doesn't exist", async () => {
    process.env.ONCHAINOS_CLI_BIN = "/nonexistent/onchainos-binary";
    await expect(runCli(["wallet", "status"])).rejects.toBeInstanceOf(CliError);
  });

  it("resolves agent get-agents into ResolvedAgent[]", async () => {
    const agents = await getAgentsByIds(["1001"]);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ agentId: "1001", role: "ASP" });
    expect(agents[0]!.walletAddress).toMatch(/^0x/);
  });

  it("resolves agent search results wrapped in {items: [...]}", async () => {
    const agents = await searchAgents("suspect");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("Suspect ASP");
  });

  it("normalizes feedback-list results wrapped in {list: [...]}, converting the 0-100 wire score to 0-5 and the numeric ms `time` to an ISO date", async () => {
    const reviews = await feedbackList("1001");
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ reviewerId: "0xReviewer2002", score: 5 });
    expect(reviews[0]!.date).toBe(new Date(Date.parse("2026-04-01T09:00:00Z")).toISOString());
  });

  it("serializes concurrent CLI calls without interleaving/racing", async () => {
    process.env.FAKE_ONCHAINOS_LOGGED_IN = "true";
    const results = await Promise.all([
      runCli(["wallet", "status"]),
      runCli(["wallet", "status"]),
      runCli(["wallet", "status"]),
    ]);
    for (const r of results) {
      expect((r as { loggedIn: boolean }).loggedIn).toBe(true);
    }
  });
});
