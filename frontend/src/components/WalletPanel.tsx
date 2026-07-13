import { useRef, useState } from "react";
import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain, useReadContract, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import type { PricingInfo } from "../lib/types";
import { truncateAddress, formatAtomic, describeConnectError } from "../lib/format";

const TOKEN_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export default function WalletPanel({ pricing }: { pricing: PricingInfo }) {
  const targetChainId = Number(pricing.network!.split(":")[1]);
  const { address, isConnected, isConnecting, chainId } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending: isConnectPending, error: connectError } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutate: switchChain, isPending: isSwitching } = useSwitchChain();
  const [mintLog, setMintLog] = useState<string | null>(null);
  // A plain retry is one of the confirmed fixes for the "wallet must has at
  // least one account" bug (a known MetaMask-extension bug, not an actual
  // missing-account state — see lib/format.ts) — retry once automatically
  // before bothering the user with it.
  const hasAutoRetried = useRef(false);

  function handleConnect() {
    const connector = connectors[0];
    if (!connector) return;
    connect(
      { connector },
      {
        onError: (err) => {
          if (!hasAutoRetried.current && /at least one account/i.test(err.message)) {
            hasAutoRetried.current = true;
            connect({ connector });
          }
        },
        onSuccess: () => {
          hasAutoRetried.current = false;
        },
      },
    );
  }

  const onWrongChain = isConnected && chainId !== targetChainId;

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: pricing.asset as `0x${string}`,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !onWrongChain },
  });

  const { mutateAsync: writeContract, isPending: isMinting } = useWriteContract();

  async function handleMint() {
    if (!address) return;
    try {
      setMintLog("Minting 1 vUSD to your wallet (demo faucet, gas-free on X Layer)…");
      const hash = await writeContract({
        address: pricing.asset as `0x${string}`,
        abi: TOKEN_ABI,
        functionName: "mint",
        args: [address, parseUnits("1", pricing.decimals ?? 6)],
      });
      setMintLog(`Minted. tx: ${hash}`);
      refetchBalance();
    } catch (err) {
      setMintLog(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-hairline bg-surface p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Step 1 · Wallet
      </h2>

      {!isConnected && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isConnecting || isConnectPending || !connectors[0]}
            onClick={handleConnect}
          >
            {isConnecting || isConnectPending ? "Connecting…" : "Connect wallet"}
          </button>
          <span className="text-xs text-muted">
            {connectors[0] ? "MetaMask or another injected wallet" : "No browser wallet found — install MetaMask"}
          </span>
        </div>
      )}
      {connectError && <p className="mt-2 text-xs text-[color:var(--critical)]">{describeConnectError(connectError)}</p>}

      {isConnected && onWrongChain && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="pill pill-warning">Wrong network</span>
          <button
            className="rounded-lg border border-accent px-3 py-1.5 text-sm font-semibold text-accent disabled:opacity-50"
            disabled={isSwitching}
            onClick={() => switchChain({ chainId: targetChainId })}
          >
            {isSwitching ? "Switching…" : "Switch to X Layer testnet"}
          </button>
        </div>
      )}

      {isConnected && !onWrongChain && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="pill pill-good">Connected</span>
          <span className="font-mono text-sm">{truncateAddress(address!)}</span>
          <span className="text-sm text-secondary">
            {balance !== undefined ? `${formatAtomic(balance.toString(), pricing.decimals ?? 6)} ${pricing.symbol ?? "vUSD"}` : "…"}
          </span>
          <button
            className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-secondary disabled:opacity-50"
            disabled={isMinting}
            onClick={handleMint}
          >
            {isMinting ? "Minting…" : "Get demo vUSD"}
          </button>
          <button className="text-xs text-muted underline" onClick={() => disconnect()}>
            Disconnect
          </button>
        </div>
      )}
      {mintLog && <p className="mt-2 text-xs text-secondary">{mintLog}</p>}
    </section>
  );
}
