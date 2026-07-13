import { useEffect, useState } from "react";
import type { EvidenceItem, IntegrityLabel, SignedIntegrityReport } from "../lib/types";
import type { SettlementInfo } from "../lib/api";
import { verifySignedReport, type ReportVerification } from "../lib/verifyReport";
import { truncateAddress } from "../lib/format";

function labelPillClass(label: IntegrityLabel): string {
  if (label === "ORGANIC") return "pill-good";
  if (label === "MIXED_SIGNAL") return "pill-warning";
  if (label === "INSUFFICIENT_DATA") return "pill-neutral";
  return "pill-critical";
}

function labelMeterColor(label: IntegrityLabel): string {
  if (label === "ORGANIC") return "var(--good)";
  if (label === "MIXED_SIGNAL") return "var(--warning)";
  return "var(--critical)";
}

function severityPillClass(sev: EvidenceItem["severity"]): string {
  if (sev === "high") return "pill-critical";
  if (sev === "warn") return "pill-warning";
  return "pill-neutral";
}

function verificationPill(v: ReportVerification | "checking"): { cls: string; text: string } {
  if (v === "checking") return { cls: "pill-neutral", text: "verifying signature…" };
  if (v === "verified") return { cls: "pill-good", text: "signature verified" };
  if (v === "unknown-signer") return { cls: "pill-warning", text: "signed by unrecognized key" };
  return { cls: "pill-critical", text: "signature invalid" };
}

export default function ReportView({
  report,
  settlement,
  expectedSigner,
}: {
  report: SignedIntegrityReport;
  settlement: SettlementInfo | null;
  expectedSigner?: string;
}) {
  const [verification, setVerification] = useState<ReportVerification | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    setVerification("checking");
    verifySignedReport(report, expectedSigner).then(({ status }) => {
      if (!cancelled) setVerification(status);
    });
    return () => {
      cancelled = true;
    };
  }, [report, expectedSigner]);

  const badge = verificationPill(verification);
  const insufficientData = report.label === "INSUFFICIENT_DATA";

  return (
    <div className="mt-5 border-t border-hairline pt-5">
      <div className="mb-1 flex items-baseline gap-3">
        <span className="text-5xl font-bold leading-none">{insufficientData ? "—" : report.integrityScore}</span>
        <span className={`pill ${labelPillClass(report.label)}`}>{report.label.replace(/_/g, " ")}</span>
        <span className={`pill ${badge.cls}`} title={`Recomputed client-side from report.signature — recovered signer must match Verigraph's known service identity (${expectedSigner ? truncateAddress(expectedSigner) : "unknown"}).`}>
          {badge.text}
        </span>
      </div>
      {insufficientData ? (
        <p className="mb-4 mt-3 text-sm text-secondary">
          None of the three detection signals returned usable data for this target — there's nothing here to
          score. This isn't a "clean" result, just an absent one (a network hiccup fetching on-chain data, or a
          target with no reviews/trade history to analyze). Try again, or check a target with an OKX.AI agent id
          and some on-chain activity.
        </p>
      ) : (
        <div className="mb-4 mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--gridline)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${report.integrityScore}%`, background: labelMeterColor(report.label) }}
          />
        </div>
      )}

      <p className="font-mono text-xs text-secondary">
        target: {report.target.walletAddress}
        {report.target.agentId ? ` (agent ${report.target.agentId})` : ""}
      </p>
      <p className="text-xs text-secondary">
        chain {report.meta.chain} · window {report.meta.dataWindow.begin.slice(0, 10)} to {report.meta.dataWindow.end.slice(0, 10)}
      </p>
      {settlement && (
        <p className="text-xs text-secondary">
          paid via x402 · settlement {settlement.txHash ? `tx ${settlement.txHash}` : JSON.stringify(settlement)}
        </p>
      )}
      <p className="font-mono text-xs text-secondary">signed by: {truncateAddress(report.signer)}</p>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Signal breakdown</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {Object.entries(report.signals).map(([name, signal]) => (
          <div key={name} className="rounded-lg border border-hairline p-3">
            <div className="text-xs text-muted">{name}</div>
            <div className="text-base font-semibold">
              {signal ? `${Math.round(signal.suspicionScore * 100)}% suspicion` : "no data"}
            </div>
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Evidence</h3>
      {report.evidence.length === 0 ? (
        <p className="text-sm text-muted">
          {insufficientData ? "No signals ran, so there's no evidence to show." : "No evidence flags — nothing suspicious found in the available signals."}
        </p>
      ) : (
        <div className="divide-y divide-hairline">
          {report.evidence.map((item, i) => (
            <div key={i} className="py-2.5">
              <div className="flex items-center gap-2">
                <span className={`pill ${severityPillClass(item.severity)}`}>{item.severity}</span>
                <span className="text-xs text-muted">{item.module}</span>
              </div>
              <p className="mt-1 text-sm">{item.summary}</p>
              {item.refs.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.refs.map((ref, j) => (
                    <span key={j} className="rounded bg-[color:var(--gridline)] px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {ref}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
