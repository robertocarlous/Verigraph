// Direct HTTP client for OKX OnchainOS's public, HMAC-signed (AK) endpoints —
// no logged-in session required. Reimplements the exact signing scheme used
// by OKX's own `onchainos` Rust CLI (see cli/src/client.rs in the research
// clone of github.com/okx/onchainos-skills): base64(HMAC-SHA256(secretKey,
// timestamp + method + requestPath + body)), timestamp as an ISO-8601
// millisecond string, headers OK-ACCESS-KEY/SIGN/PASSPHRASE/TIMESTAMP. Kept
// separate from cliClient.ts (which shells out to the real CLI for
// session-gated endpoints) so this hot path has zero process-spawn overhead.

import { createHmac } from "node:crypto";
import axios, { type AxiosInstance } from "axios";
import type { TxRecord } from "../types.js";
import { optionalEnv, requireEnv } from "../env.js";

export interface OkxCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export function loadCredentialsFromEnv(): OkxCredentials {
  return {
    apiKey: requireEnv("OKX_API_KEY"),
    secretKey: requireEnv("OKX_SECRET_KEY"),
    passphrase: requireEnv("OKX_PASSPHRASE"),
  };
}

/** base64(HMAC-SHA256(secretKey, timestamp+method+requestPath+body)) — mirrors cli/src/client.rs `hmac_sign`. */
export function signOkxRequest(secretKey: string, timestamp: string, method: string, requestPath: string, body: string): string {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  return createHmac("sha256", secretKey).update(prehash).digest("base64");
}

/** Drops empty-value params and builds `path?query` — matches the reference CLI's `build_get_url_and_request_path`. */
export function buildRequestPath(path: string, query: Record<string, string | undefined>): string {
  const filteredEntries = Object.entries(query).filter((entry): entry is [string, string] => !!entry[1]);
  const queryString = new URLSearchParams(filteredEntries).toString();
  return queryString ? `${path}?${queryString}` : path;
}

export interface RestClientRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

// Confirmed live: the path from this environment to web3.okx.com
// intermittently times out or degrades (same flakiness agent/transferLoop.ts
// and x402/settle.ts already retry around) even though the same call
// reliably succeeds on a clean connection. Unlike the settlement broadcast,
// this is a plain signed GET — unconditionally safe to retry, no
// side-effect/replay risk at all.
const REST_RETRY_ATTEMPTS = 3;
const REST_RETRY_BASE_DELAY_MS = 2000;

export class OnchainOsRestClient {
  private readonly http: AxiosInstance;
  private readonly creds: OkxCredentials;
  private readonly retry: Required<RestClientRetryOptions>;

  constructor(
    creds: OkxCredentials,
    baseUrl = optionalEnv("OKX_BASE_URL", "https://web3.okx.com"),
    retry: RestClientRetryOptions = {},
  ) {
    this.creds = creds;
    this.http = axios.create({ baseURL: baseUrl, timeout: 15_000 });
    this.retry = { attempts: retry.attempts ?? REST_RETRY_ATTEMPTS, baseDelayMs: retry.baseDelayMs ?? REST_RETRY_BASE_DELAY_MS };
  }

  /** Signed GET against a public OKX OnchainOS endpoint. Empty-value params are dropped, matching the reference CLI. */
  async signedGet<T = unknown>(path: string, query: Record<string, string | undefined>): Promise<T> {
    const requestPath = buildRequestPath(path, query);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      const timestamp = new Date().toISOString();
      const signature = signOkxRequest(this.creds.secretKey, timestamp, "GET", requestPath, "");
      try {
        const response = await this.http.get(requestPath, {
          headers: {
            "Content-Type": "application/json",
            "OK-ACCESS-KEY": this.creds.apiKey,
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-PASSPHRASE": this.creds.passphrase,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "ok-client-type": "cli",
            "Ok-Access-Client-type": "agent-cli",
          },
        });
        return unwrapEnvelope<T>(response.data);
      } catch (err) {
        lastErr = err;
        if (attempt < this.retry.attempts) {
          await new Promise((r) => setTimeout(r, this.retry.baseDelayMs * attempt));
        }
      }
    }
    throw lastErr;
  }
}

/** OKX API responses wrap the payload in {code, msg, data}; unwrap defensively since dex-history's exact envelope shape isn't in the public docs we have. */
function unwrapEnvelope<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data as T;
  }
  return body as T;
}

export interface DexHistoryParams {
  address: string;
  chainIndex: string;
  beginMs: number;
  endMs: number;
  limit?: number;
  cursor?: string;
  tokenContractAddress?: string;
  txType?: string;
}

export interface DexHistoryPage {
  transactionList: TxRecord[];
  cursor?: string;
}

export async function fetchDexHistoryPage(client: OnchainOsRestClient, params: DexHistoryParams): Promise<DexHistoryPage> {
  const raw = await client.signedGet<{ transactionList?: TxRecord[]; cursor?: string } | { transactionList?: TxRecord[]; cursor?: string }[]>(
    "/api/v6/dex/market/portfolio/dex-history",
    {
      chainIndex: params.chainIndex,
      walletAddress: params.address,
      begin: String(params.beginMs),
      end: String(params.endMs),
      limit: params.limit ? String(params.limit) : undefined,
      cursor: params.cursor,
      tokenContractAddress: params.tokenContractAddress,
      type: params.txType,
    },
  );
  const page = Array.isArray(raw) ? raw[0] : raw;
  return { transactionList: page?.transactionList ?? [], cursor: page?.cursor };
}

/** Fetches up to `maxRecords` (default 1000, matching OKX's documented cap) across pages. */
export async function fetchDexHistory(
  client: OnchainOsRestClient,
  params: Omit<DexHistoryParams, "cursor" | "limit">,
  maxRecords = 1000,
): Promise<TxRecord[]> {
  const all: TxRecord[] = [];
  let cursor: string | undefined;
  const pageSize = 100;
  while (all.length < maxRecords) {
    const page = await fetchDexHistoryPage(client, { ...params, cursor, limit: pageSize });
    all.push(...page.transactionList);
    if (!page.cursor || page.transactionList.length === 0) break;
    cursor = page.cursor;
  }
  return all.slice(0, maxRecords);
}
