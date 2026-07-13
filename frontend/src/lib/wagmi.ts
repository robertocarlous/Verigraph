import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { buildXLayerTestnet } from "./chain";

export function buildWagmiConfig(rpcUrl: string, chainId: number) {
  const chain = buildXLayerTestnet(rpcUrl, chainId);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(rpcUrl) },
  });
}

export type WagmiAppConfig = ReturnType<typeof buildWagmiConfig>;
