import { useState } from "react";
import { useConnection, useSignTypedData } from "wagmi";
import { parseSignature } from "viem";
import type { PricingInfo, SignedIntegrityReport } from "../lib/types";
import { requestChallenge, submitPayment, randomNonce, type SettlementInfo } from "../lib/api";
import ReportView from "./ReportView";

const EXAMPLE_TARGETS = [
  // A raw wallet address never resolves an agentId (resolveTarget() only
  // looks up agent-id metadata for non-address identifiers), so
  // reputationGraph/onchainCrossRef stay null for it. The self-play wallet
  // only has on-chain transfer evidence, not agent-marketplace reviews, so
  // that's fine — but the real agent example must use its agent id, not its
  // wallet address, or it never exercises the primary detection signal.
  { label: "Self-play test wallet (ours)", value: "0xa4e2ba9041f10d9936a53cbe7314eebd875b108c" },
  { label: "Real OKX.AI agent #3118 (CoinWM)", value: "3118" },
];

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export default function CheckPanel({ pricing }: { pricing: PricingInfo }) {
  const targetChainId = Number(pricing.network!.split(":")[1]);
  const { address, isConnected, chainId } = useConnection();
  const { mutateAsync: signTypedData } = useSignTypedData();
  const [target, setTarget] = useState("");
  const [log, setLog] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ report: SignedIntegrityReport; settlement: SettlementInfo | null } | null>(null);

  const ready = isConnected && chainId === targetChainId && target.trim().length > 0 && !busy;

  async function handleCheck() {
    if (!address) return;
    setBusy(true);
    setResult(null);
    try {
      setIsError(false);
      setLog("1/3 Requesting payment challenge…");
      const challenge = await requestChallenge(target.trim());
      const accept = challenge.accepts[0];
      if (!accept) throw new Error("server returned a 402 challenge with no accepted payment methods");

      const authorization = {
        from: address,
        to: accept.payTo as `0x${string}`,
        value: BigInt(accept.amount),
        validAfter: 0n,
        validBefore: BigInt(Math.floor(Date.now() / 1000) + accept.maxTimeoutSeconds),
        nonce: randomNonce(),
      };

      setLog(`2/3 Waiting for wallet signature (${(Number(accept.amount) / 10 ** accept.extra.decimals).toFixed(2)} ${accept.extra.name})…`);
      const signature = await signTypedData({
        domain: {
          name: accept.extra.name,
          version: accept.extra.version,
          chainId: Number(accept.network.split(":")[1]),
          verifyingContract: accept.asset as `0x${string}`,
        },
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: authorization,
      });

      const { r, s, v } = parseSignature(signature);
      if (v === undefined) throw new Error("wallet returned a signature without a recoverable v value");

      setLog("3/3 Settling payment on-chain and running detection (a few seconds)…");
      const payload = {
        scheme: "exact" as const,
        network: accept.network,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
          nonce: authorization.nonce,
        },
        signature: { v: Number(v), r, s },
      };
      const { report, settlement } = await submitPayment(target.trim(), payload);
      setResult({ report, settlement });
      setLog("Done.");
    } catch (err) {
      setIsError(true);
      setLog(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-hairline bg-surface p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Step 2 · Check an agent
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[260px] flex-1 rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="0xWalletAddress or OKX.AI agent id"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!ready}
          onClick={handleCheck}
        >
          {busy ? "Checking…" : "Check reputation"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        An agent id checks reputation, tx patterns, and cross-referencing. A
        wallet address alone only checks on-chain tx patterns — the reviewer
        graph needs an agent id to look up.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLE_TARGETS.map((ex) => (
          <button
            key={ex.value}
            className="rounded-full border border-hairline px-2.5 py-1 text-xs text-secondary hover:border-accent hover:text-accent"
            onClick={() => setTarget(ex.value)}
          >
            {ex.label}
          </button>
        ))}
      </div>
      {log && <p className={`mt-3 text-xs ${isError ? "text-[color:var(--critical)]" : "text-secondary"}`}>{log}</p>}
      {result && <ReportView report={result.report} settlement={result.settlement} expectedSigner={pricing.signerAddress} />}
    </section>
  );
}
