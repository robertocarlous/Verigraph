// Manual, real end-to-end check of the x402 payment gate: spins up a local
// Hardhat chain, deploys the real DemoEIP3009Token contract to it, starts the
// real Express server against that chain, and drives a real buyer flow
// (402 -> sign -> pay -> 200, then replay -> 409) through real HTTP + a real
// on-chain settlement transaction. This is NOT part of `npm test` (vitest
// only picks up *.test.ts) — run it explicitly:
//
//   npx tsx backend/test/integration/localE2E.ts
//
// It stands in for X Layer testnet (same JSON-RPC interface) so the full
// pipeline is provably correct before real OKX credentials / a funded X
// Layer testnet wallet exist. Business-logic signals will show up as null
// (no OKX credentials in this environment) — that's expected; what this
// proves is the payment gate itself: real contract, real chain, real server.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { type ChildProcess, spawn } from "node:child_process";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/test/integration -> backend/test -> backend -> project root
const ROOT = join(__dirname, "..", "..", "..");
// hardhat.config.cjs sets `paths.sources: "./contract"`, so the artifact's
// sourceName segment is "contract", not the Hardhat-default "contracts".
const ARTIFACT_PATH = join(ROOT, "artifacts", "contract", "DemoEIP3009Token.sol", "DemoEIP3009Token.json");
const HARDHAT_RPC = "http://127.0.0.1:8545";
const SERVER_PORT = 8499;

// Hardhat node's default accounts are deterministic but we parse the private
// keys straight from its own startup log rather than hardcoding them from
// memory — safer than retyping 32-byte hex constants by hand.
interface HardhatAccounts {
  deployer: string;
  relayer: string;
  payTo: string;
  buyer: string;
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function waitForPort(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error(`timed out waiting for ${url}`));
          else setTimeout(tryOnce, 500);
        });
    };
    tryOnce();
  });
}

function spawnLogged(label: string, command: string, args: string[], env: NodeJS.ProcessEnv, onStdout?: (chunk: string) => void): ChildProcess {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env } });
  child.stdout.on("data", (d: Buffer) => {
    process.stdout.write(`[${label}] ${d}`);
    onStdout?.(d.toString());
  });
  child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  return child;
}

function parseHardhatAccounts(log: string): HardhatAccounts {
  const keys = [...log.matchAll(/Private Key: (0x[0-9a-fA-F]{64})/g)].map((m) => m[1]!);
  if (keys.length < 4) throw new Error(`expected at least 4 Hardhat account keys in startup log, found ${keys.length}`);
  return { deployer: keys[0]!, relayer: keys[1]!, payTo: keys[2]!, buyer: keys[3]! };
}

async function main(): Promise<void> {
  const children: ChildProcess[] = [];
  const cleanup = () => children.forEach((c) => c.kill());
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  console.log("1. Starting local Hardhat chain ...");
  let hardhatLog = "";
  children.push(spawnLogged("hardhat", "npx", ["hardhat", "node"], {}, (chunk) => (hardhatLog += chunk)));
  await waitForPort(HARDHAT_RPC);
  await new Promise((r) => setTimeout(r, 1000));
  const HARDHAT_KEYS = parseHardhatAccounts(hardhatLog);

  console.log("2. Deploying DemoEIP3009Token ...");
  const provider = new ethers.JsonRpcProvider(HARDHAT_RPC);
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { abi: ethers.InterfaceAbi; bytecode: string };
  const deployer = new ethers.Wallet(HARDHAT_KEYS.deployer, provider);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const token = await factory.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`   deployed at ${tokenAddress}`);

  console.log("3. Minting 1000 vUSD to the buyer ...");
  const buyerWallet = new ethers.Wallet(HARDHAT_KEYS.buyer, provider);
  const mintFn = token.getFunction("mint");
  // Explicit nonce: avoids a race where ethers' nonce lookup for this tx
  // resolves before the provider has caught up with the just-mined deploy tx.
  const mintNonce = await provider.getTransactionCount(deployer.address, "latest");
  await (await mintFn(buyerWallet.address, ethers.parseUnits("1000", 6), { nonce: mintNonce })).wait(1);

  console.log("4. Starting the Verigraph server against the local chain ...");
  const payToWallet = new ethers.Wallet(HARDHAT_KEYS.payTo);
  children.push(
    spawnLogged("server", "npx", ["tsx", "backend/src/server.ts"], {
      PORT: String(SERVER_PORT),
      XLAYER_TESTNET_RPC_URL: HARDHAT_RPC,
      RELAYER_PRIVATE_KEY: HARDHAT_KEYS.relayer,
      SERVICE_WALLET_ADDRESS: payToWallet.address,
      DEMO_TOKEN_ADDRESS: tokenAddress,
      PRICE_ATOMIC_UNITS: "10000",
      DOTENV_CONFIG_PATH: "/dev/null",
    }),
  );
  const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;
  await waitForPort(`${baseUrl}/v1/health`);
  await new Promise((r) => setTimeout(r, 500));

  console.log("5. Checking /v1/health + /v1/pricing report the payment gate as configured ...");
  const health = (await (await fetch(`${baseUrl}/v1/health`)).json()) as { paymentConfigured: boolean };
  assert(health.paymentConfigured === true, "expected paymentConfigured=true once the chain/token/keys are set");
  const pricing = (await (await fetch(`${baseUrl}/v1/pricing`)).json()) as { configured: boolean; asset: string };
  assert(pricing.configured === true && pricing.asset === tokenAddress, "pricing should reflect the deployed token");

  console.log("6. Requesting without payment -> expect 402 with a decodable challenge ...");
  const target = ethers.Wallet.createRandom().address;
  const noPay = await fetch(`${baseUrl}/v1/integrity-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  assert(noPay.status === 402, `expected 402, got ${noPay.status}`);
  const challengeHeader = noPay.headers.get("PAYMENT-REQUIRED");
  assert(!!challengeHeader, "expected a PAYMENT-REQUIRED header");
  const challenge = JSON.parse(Buffer.from(challengeHeader!, "base64").toString("utf8"));
  const accept = challenge.accepts[0];
  console.log(`   challenge: ${accept.amount} atomic units of ${accept.asset} to ${accept.payTo}`);

  console.log("7. Signing a real EIP-3009 authorization as the buyer ...");
  const nowSec = Math.floor(Date.now() / 1000);
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const authorization = {
    from: buyerWallet.address,
    to: accept.payTo,
    value: BigInt(accept.amount),
    validAfter: 0n,
    validBefore: BigInt(nowSec + accept.maxTimeoutSeconds),
    nonce,
  };
  const domain = {
    name: accept.extra.name,
    version: accept.extra.version,
    chainId: Number(accept.network.split(":")[1]),
    verifyingContract: accept.asset,
  };
  const signature = await buyerWallet.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);
  const sig = ethers.Signature.from(signature);
  const paymentPayload = {
    scheme: "exact",
    network: accept.network,
    authorization: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
      nonce,
    },
    signature: { v: sig.v, r: sig.r, s: sig.s },
  };
  const xPayment = Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64");

  console.log("8. Replaying with X-PAYMENT -> expect 200 + a real on-chain settlement tx ...");
  const paid = await fetch(`${baseUrl}/v1/integrity-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT": xPayment },
    body: JSON.stringify({ target }),
  });
  const paidBody = (await paid.json()) as { integrityScore: number; label: string };
  assert(paid.status === 200, `expected 200, got ${paid.status}: ${JSON.stringify(paidBody)}`);
  const paymentResponseHeader = paid.headers.get("PAYMENT-RESPONSE");
  assert(!!paymentResponseHeader, "expected a PAYMENT-RESPONSE header");
  const settlement = JSON.parse(Buffer.from(paymentResponseHeader!, "base64").toString("utf8"));
  console.log(`   settled on-chain: tx=${settlement.txHash} block=${settlement.blockNumber}`);
  console.log(`   integrity report: score=${paidBody.integrityScore} label=${paidBody.label}`);

  const receipt = await provider.getTransactionReceipt(settlement.txHash);
  assert(!!receipt && receipt.status === 1, "settlement tx must be confirmed on-chain with status=1");
  const buyerBalance = await token.getFunction("balanceOf")(buyerWallet.address);
  console.log(`   buyer's on-chain balance after payment: ${ethers.formatUnits(buyerBalance as bigint, 6)} vUSD`);

  console.log("9. Replaying the SAME X-PAYMENT again -> expect 409, not a second charge ...");
  const replay = await fetch(`${baseUrl}/v1/integrity-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT": xPayment },
    body: JSON.stringify({ target }),
  });
  assert(replay.status === 409, `expected 409 on replay, got ${replay.status}`);

  console.log("\n✅ ALL CHECKS PASSED — real 402 -> sign -> pay -> 200 -> confirmed on-chain -> replay-blocked, end to end.");
  cleanup();
  process.exit(0);
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

main().catch((err) => {
  console.error("\n❌ E2E CHECK FAILED:", err);
  process.exit(1);
});
