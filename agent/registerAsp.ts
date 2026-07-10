// One-time admin script: registers Verigraph as an ASP identity on OKX.AI and
// lists its paid integrity-check service. NOT part of the live server — run
// manually once OKX credentials + a funded wallet exist. Follows the documented
// flow in skills/okx-ai/references/identity-register.md (pre-check -> consent
// gate if first-time -> avatar upload -> validate-listing QA -> create ->
// activate). Deliberately conservative: stops and asks for a human decision at
// every point that flow document treats as a mandatory confirmation gate
// (consent terms, QA findings) rather than auto-accepting on your behalf.

import { requireEnv, optionalEnv } from "../backend/src/env.js";
import { ensureLoggedIn } from "../backend/src/onchainos/authManager.js";
import { runCli } from "../backend/src/onchainos/cliClient.js";

interface PreCheckResult {
  canCreate: boolean;
  role: string;
  reason?: string;
  consent?: { terms: string; consentKey: string };
  existingSameRole?: { agentId: string; name: string }[];
  aspCount?: number;
}

interface ValidateListingResult {
  pass: boolean;
  findings: { field: string; code: string; severity: string; issue: string; fix: string }[];
}

async function main(): Promise<void> {
  await ensureLoggedIn();

  const consentKey = process.env.ASP_CONSENT_KEY;
  const preCheckArgs = ["agent", "pre-check", "--role", "asp"];
  if (consentKey) preCheckArgs.push("--consent-key", consentKey);
  const preCheck = (await runCli(preCheckArgs)) as PreCheckResult;

  if (preCheck.consent) {
    console.log("\nFirst-time registration requires accepting these terms:\n");
    console.log(preCheck.consent.terms);
    console.log(
      `\nReview the terms above. If you agree, re-run this script with:\n  ASP_CONSENT_KEY=${preCheck.consent.consentKey} npm run asp:register`,
    );
    return;
  }

  if (!preCheck.canCreate) {
    console.log(`Cannot register a new ASP identity: ${preCheck.reason ?? "unknown reason"}`);
    if (preCheck.existingSameRole?.length) {
      console.log("Existing ASP identities on this wallet:");
      for (const asp of preCheck.existingSameRole) console.log(`  #${asp.agentId} — ${asp.name}`);
      console.log('Use a separate wallet to register another ASP, or update the existing one (not handled by this script).');
    }
    return;
  }

  const name = requireEnv("ASP_NAME");
  const description = requireEnv("ASP_DESCRIPTION");
  const avatarPath = requireEnv("ASP_AVATAR_PATH");
  const serviceName = requireEnv("ASP_SERVICE_NAME");
  const serviceDescription = requireEnv("ASP_SERVICE_DESCRIPTION");
  const serviceType = optionalEnv("ASP_SERVICE_TYPE", "A2MCP"); // API-callable integrity-check endpoint
  const serviceFee = requireEnv("ASP_SERVICE_FEE"); // plain number string, USDT, e.g. "0.05"
  const serviceEndpoint = serviceType === "A2MCP" ? requireEnv("ASP_SERVICE_ENDPOINT") : undefined;

  console.log(`Uploading avatar from ${avatarPath} ...`);
  const uploadResult = (await runCli(["agent", "upload", "--file", avatarPath])) as { url?: string };
  const pictureUrl = uploadResult.url;
  if (!pictureUrl) throw new Error(`avatar upload did not return a url: ${JSON.stringify(uploadResult)}`);
  console.log(`Avatar uploaded: ${pictureUrl}`);

  const services = [
    {
      name: serviceName,
      description: serviceDescription,
      type: serviceType,
      fee: serviceFee,
      ...(serviceEndpoint ? { endpoint: serviceEndpoint } : {}),
    },
  ];

  console.log("Running validate-listing QA ...");
  const validation = (await runCli([
    "agent",
    "validate-listing",
    "--role",
    "asp",
    "--name",
    name,
    "--description",
    description,
    "--service",
    JSON.stringify(services),
  ])) as ValidateListingResult;

  if (!validation.pass || validation.findings.length > 0) {
    console.log("\nvalidate-listing flagged issues — fix the corresponding ASP_* env vars and re-run:\n");
    for (const f of validation.findings) {
      console.log(`  [${f.severity}] ${f.field}: ${f.issue} -> ${f.fix}`);
    }
    return;
  }

  console.log("Listing passed QA. Creating the ASP identity on-chain ...");
  const created = (await runCli([
    "agent",
    "create",
    "--role",
    "asp",
    "--name",
    name,
    "--description",
    description,
    "--picture",
    pictureUrl,
    "--service",
    JSON.stringify(services),
  ])) as { newAgentId: string | null };

  if (!created.newAgentId) {
    console.log("Create call succeeded but newAgentId came back null (WS push timed out) — check `agent get-my-agents` manually.");
    return;
  }

  console.log(`ASP identity #${created.newAgentId} registered (not yet visible to others).`);

  if (optionalEnv("ASP_AUTO_ACTIVATE", "true") === "true") {
    console.log(`Activating #${created.newAgentId} ...`);
    await runCli(["agent", "activate", "--agent-id", created.newAgentId]);
    console.log(`ASP identity #${created.newAgentId} is now live on OKX.AI.`);
  } else {
    console.log(`Run \`onchainos agent activate --agent-id ${created.newAgentId}\` when ready to go live.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
