// One-time admin script: deploys DemoEIP3009Token to X Layer testnet and
// optionally mints starter balances to the two self-play demo wallets. Not
// part of the live server. Run `npm run compile:contracts` first.
//
// Required env: XLAYER_TESTNET_RPC_URL, DEMO_TOKEN_DEPLOYER_PRIVATE_KEY.
// Optional env: DEMO_WALLET_A_ADDRESS, DEMO_WALLET_B_ADDRESS, DEMO_MINT_AMOUNT
// (human units, default "1000").

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { optionalEnv, requireEnv } from "../backend/src/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// hardhat.config.cjs sets `paths.sources: "./contract"`, so the artifact's
// sourceName segment is "contract" (relative to the project root), not the
// Hardhat-default "contracts".
const ARTIFACT_PATH = join(__dirname, "..", "artifacts", "contract", "DemoEIP3009Token.sol", "DemoEIP3009Token.json");
const OUTPUT_PATH = join(__dirname, ".deployed-token.json");

interface Artifact {
  abi: ethers.InterfaceAbi;
  bytecode: string;
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv("XLAYER_TESTNET_RPC_URL");
  const deployerKey = requireEnv("DEMO_TOKEN_DEPLOYER_PRIVATE_KEY");
  const mintAmountHuman = optionalEnv("DEMO_MINT_AMOUNT", "1000");

  let artifact: Artifact;
  try {
    artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as Artifact;
  } catch {
    throw new Error(`Contract artifact not found at ${ARTIFACT_PATH} — run "npm run compile:contracts" first.`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(deployerKey, provider);

  console.log(`Deploying DemoEIP3009Token to chainId=${network.chainId} from ${wallet.address} ...`);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  const deployTx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`Deployed DemoEIP3009Token at ${address} (tx: ${deployTx?.hash})`);

  const decimals = 6;
  const mintAmount = ethers.parseUnits(mintAmountHuman, decimals);
  const mintTargets = [process.env.DEMO_WALLET_A_ADDRESS, process.env.DEMO_WALLET_B_ADDRESS].filter(
    (a): a is string => !!a,
  );

  const mintTxHashes: string[] = [];
  for (const target of mintTargets) {
    const mintFn = contract.getFunction("mint");
    const tx = await mintFn(target, mintAmount);
    const receipt = await tx.wait(1);
    console.log(`Minted ${mintAmountHuman} vUSD to ${target} (tx: ${receipt?.hash})`);
    if (receipt?.hash) mintTxHashes.push(receipt.hash);
  }

  const summary = {
    address,
    chainId: Number(network.chainId),
    deployTxHash: deployTx?.hash,
    mintTxHashes,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nWrote deployment summary to ${OUTPUT_PATH}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
