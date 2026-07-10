// Plain CommonJS Hardhat config, used ONLY for `npm run compile:contracts`
// (produces artifacts/ ABI+bytecode consumed by contract/deployDemoToken.ts
// via plain ethers.js — no hardhat-ethers plugin / HRE dependency at runtime).
// Sources live in contract/ (not the Hardhat-default contracts/), so the
// project is organized into exactly three code folders: contract/, agent/,
// backend/. Kept at the project root (rather than moved into contract/)
// since Hardhat conventionally discovers its config via cwd.
require("dotenv/config");

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  paths: {
    sources: "./contract",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // NOTE: OKX's own onchainos CLI does not ship a hardcoded RPC URL for X Layer
    // testnet (chainId 1952) — only mainnet (196 -> https://rpc.xlayer.tech) is
    // wired in their source. Get the current testnet RPC URL from X Layer's
    // official docs / Chainlist and set XLAYER_TESTNET_RPC_URL yourself — do not
    // assume a URL here without verifying it against the live docs first.
    xlayerTestnet: {
      url: process.env.XLAYER_TESTNET_RPC_URL || "",
      chainId: 1952,
      accounts: process.env.DEMO_TOKEN_DEPLOYER_PRIVATE_KEY ? [process.env.DEMO_TOKEN_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
