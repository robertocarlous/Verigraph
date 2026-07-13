import { recoverMessageAddress } from "viem";
import type { SignedIntegrityReport } from "./types";
import { stableStringify } from "./canonicalize";

export type ReportVerification = "verified" | "signature-invalid" | "unknown-signer";

/**
 * Recomputes the same canonical JSON the server signed (see
 * backend/src/x402/reportSigning.ts) and recovers the signer from
 * `report.signature` — this runs entirely client-side, so it's checking the
 * server's claim rather than trusting it. `expectedSigner` (from
 * /v1/pricing) is what turns "some key signed this" into "*Verigraph's*
 * known service identity signed this" — without it, a report could be
 * internally self-consistent (signature matches `report.signer`) while
 * `signer` itself is an unrelated key.
 */
export async function verifySignedReport(
  report: SignedIntegrityReport,
  expectedSigner?: string,
): Promise<{ status: ReportVerification; recovered?: string }> {
  const { signature, signer, ...rest } = report;
  const message = stableStringify(rest);

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  } catch {
    return { status: "signature-invalid" };
  }

  if (recovered.toLowerCase() !== signer.toLowerCase()) return { status: "signature-invalid", recovered };
  if (expectedSigner && recovered.toLowerCase() !== expectedSigner.toLowerCase()) return { status: "unknown-signer", recovered };
  return { status: "verified", recovered };
}
