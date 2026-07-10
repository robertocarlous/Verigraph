import { describe, expect, it } from "vitest";
import { buildRequestPath, signOkxRequest } from "../../src/onchainos/restClient.js";

describe("buildRequestPath", () => {
  it("drops empty/undefined params and preserves insertion order", () => {
    const path = buildRequestPath("/api/v6/dex/market/portfolio/dex-history", {
      chainIndex: "1952",
      walletAddress: "0xabc",
      begin: "1000",
      end: "2000",
      limit: undefined,
      cursor: "",
      tokenContractAddress: undefined,
      type: undefined,
    });
    expect(path).toBe("/api/v6/dex/market/portfolio/dex-history?chainIndex=1952&walletAddress=0xabc&begin=1000&end=2000");
  });

  it("returns the bare path when there are no params", () => {
    expect(buildRequestPath("/api/v6/foo", {})).toBe("/api/v6/foo");
  });
});

// Mirrors OKX's own reference-CLI test suite for `hmac_sign`
// (cli/src/client.rs: hmac_sign_is_deterministic / _differs_by_method /
// _differs_by_body / _differs_by_secret / output_is_base64) so our
// reimplementation is held to the same behavioral contract.
describe("signOkxRequest", () => {
  const timestamp = "2026-07-10T12:00:00.000Z";
  const path = "/api/v6/dex/market/portfolio/dex-history?chainIndex=1952&walletAddress=0xabc";

  it("is deterministic for identical inputs", () => {
    const a = signOkxRequest("secret", timestamp, "GET", path, "");
    const b = signOkxRequest("secret", timestamp, "GET", path, "");
    expect(a).toBe(b);
  });

  it("differs by HTTP method", () => {
    const get = signOkxRequest("secret", timestamp, "GET", path, "");
    const post = signOkxRequest("secret", timestamp, "POST", path, "");
    expect(get).not.toBe(post);
  });

  it("differs by body", () => {
    const empty = signOkxRequest("secret", timestamp, "POST", path, "");
    const withBody = signOkxRequest("secret", timestamp, "POST", path, '{"foo":"bar"}');
    expect(empty).not.toBe(withBody);
  });

  it("differs by secret", () => {
    const a = signOkxRequest("secret-a", timestamp, "GET", path, "");
    const b = signOkxRequest("secret-b", timestamp, "GET", path, "");
    expect(a).not.toBe(b);
  });

  it("produces a base64 string", () => {
    const sig = signOkxRequest("secret", timestamp, "GET", path, "");
    expect(() => Buffer.from(sig, "base64")).not.toThrow();
    expect(Buffer.from(sig, "base64").length).toBe(32); // HMAC-SHA256 digest is 32 bytes
  });
});
