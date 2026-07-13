import { defineChain } from "viem";

// X Layer testnet is not in viem/wagmi's built-in chain list, and the RPC
// URL is only known at runtime from GET /v1/pricing (the backend deliberately
// doesn't hardcode it — see README — since OKX's own onchainos CLI only
// wires up mainnet). This factory builds the chain object once pricing has
// loaded.
export function buildXLayerTestnet(rpcUrl: string, chainId: number) {
  return defineChain({
    id: chainId,
    name: "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}
