#!/usr/bin/env node
// Fake stand-in for the real `onchainos` binary, used only in tests to
// exercise cliClient.ts/authManager.ts's subprocess plumbing (spawn, JSON
// parsing, error/exit-code handling, mutex serialization) without requiring
// the real Rust CLI, OKX credentials, or network access. Mirrors the REAL
// binary's confirmed envelope: `{"ok":true,"data":{...}}` (exit 0) or
// `{"ok":false,"error":"..."}` (exit 1, still valid JSON on stdout — not
// stderr). Controlled via argv and the FAKE_ONCHAINOS_LOGGED_IN env var.
const args = process.argv.slice(2);

function ok(data) {
  process.stdout.write(JSON.stringify({ ok: true, data }));
  process.exit(0);
}

function businessError(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function crash(message, code = 1) {
  process.stderr.write(message);
  process.exit(code);
}

if (args.includes("fail")) {
  crash("simulated CLI crash: no JSON produced at all");
}
if (args.includes("businessfail")) {
  businessError("simulated business error: missing required parameter");
}
if (args.includes("badjson")) {
  process.stdout.write("{not valid json");
  process.exit(0);
}
if (args.includes("multiline")) {
  // Confirmed live in production: a fresh session can make the CLI print an
  // implicit login-result line before the actual command's result line.
  process.stdout.write(JSON.stringify({ ok: true, data: { accountId: "acct-1", isNew: false } }) + "\n");
  process.stdout.write(JSON.stringify({ ok: true, data: { real: "result" } }));
  process.exit(0);
}
if (args.includes("hang")) {
  setTimeout(() => process.exit(0), 10_000);
  return;
}

const [group, sub] = args;

if (group === "wallet" && sub === "status") {
  const loggedIn = process.env.FAKE_ONCHAINOS_LOGGED_IN === "true";
  ok(loggedIn ? { loggedIn: true, loginType: "ak", currentAccountId: "acct-1", currentAccountName: "verigraph-service" } : { loggedIn: false });
}

if (group === "wallet" && sub === "login") {
  ok({ accountId: "acct-1", accountName: "Account 1", isNew: true });
}

// Field shapes below mirror the REAL `onchainos` v4.2.2 binary's actual
// output (confirmed live against production OKX.AI), not the skill docs'
// prose-rendering description — see cliClient.ts's normalize* comments.
if (group === "agent" && sub === "get-agents") {
  ok([{ agentId: "1001", agentWalletAddress: "0xTargetWallet000000000000000000000001", roleLabel: "ASP", name: "Demo ASP" }]);
}

if (group === "agent" && sub === "search") {
  ok({ items: [{ agentId: "2002", communicationAddress: "0xColluderWallet00000000000000000002", roleLabel: "ASP", name: "Suspect ASP" }] });
}

if (group === "agent" && sub === "feedback-list") {
  ok({
    list: [
      { reviewerAddress: "0xReviewer2002", agentName: "Colluder", value: "100", valueString: "100", time: Date.parse("2026-04-01T09:00:00Z"), id: 9001, content: "Great!" },
      { reviewerAddress: "0xReviewer2002", agentName: "Colluder", value: "100", valueString: "100", time: Date.parse("2026-04-01T09:20:00Z"), id: 9002, content: "Great!!" },
    ],
  });
}

crash(`fake-onchainos-cli: unhandled args ${JSON.stringify(args)}`, 1);
