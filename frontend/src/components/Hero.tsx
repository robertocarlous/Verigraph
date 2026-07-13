import type { PricingInfo } from "../lib/types";
import { formatAtomic } from "../lib/format";

const STEPS = [
  { n: 1, label: "Connect a wallet", detail: "MetaMask on X Layer testnet" },
  { n: 2, label: "Pay per query", detail: "x402 · EIP-3009, no account needed" },
  { n: 3, label: "Get an integrity report", detail: "score, label, and cited evidence" },
];

export default function Hero({ pricing }: { pricing: PricingInfo }) {
  const price =
    pricing.amountAtomic && pricing.decimals !== undefined
      ? `$${formatAtomic(pricing.amountAtomic, pricing.decimals)} ${pricing.symbol ?? ""}`
      : null;

  return (
    <section className="mb-8">
      <p className="mb-6 max-w-xl text-sm leading-relaxed text-secondary">
        Verigraph is a pay-per-query Agent Service Provider: give it a wallet address
        or OKX.AI agent id and it checks whether that agent's reputation looks
        organically earned, or manufactured via wash-trading / wash-rating collusion
        between colluding wallets. {price && <>Priced at <span className="font-medium text-primary">{price}</span> per check.</>}
      </p>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-lg border border-hairline bg-surface p-3">
            <div className="mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
              {s.n}
            </div>
            <div className="text-sm font-medium">{s.label}</div>
            <div className="text-xs text-muted">{s.detail}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
