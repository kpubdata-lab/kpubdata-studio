/**
 * URL source endpoint secret redaction (PR #283 review, Epic #246).
 *
 * Verifies contract reusing existing detector from `features/assistant/scrub.ts`
 * (`isSecretKey`/`looksLikeSecret`) — judge only query parameter values. Don't
 * reinvent secret detection regex here.
 */
import { describe, expect, it } from "vitest";
import { endpointHasRedactedSecret, redactUrlEndpoint, sanitizeUrlEndpointForStorage, urlHasUserinfo } from "./urlRedaction";

const SECRET = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";

describe("redactUrlEndpoint", () => {
  it("api_key query parameter value replaced with [REDACTED]", () => {
    const result = redactUrlEndpoint(`https://api.example.org/data?api_key=${SECRET}`);
    expect(result.hadSecret).toBe(true);
    expect(result.endpoint).not.toContain(SECRET);
    expect(result.endpoint).toContain("REDACTED");
  });

  it("serviceKey query parameter value replaced with [REDACTED]", () => {
    const result = redactUrlEndpoint(`https://api.data.go.kr/openapi?serviceKey=${SECRET}`);
    expect(result.hadSecret).toBe(true);
    expect(result.endpoint).not.toContain(SECRET);
  });

  it("token query parameter value replaced with [REDACTED]", () => {
    const result = redactUrlEndpoint(`https://api.example.org/v1?token=${SECRET}`);
    expect(result.hadSecret).toBe(true);
    expect(result.endpoint).not.toContain(SECRET);
  });

  it("High-entropy value redacted even if key name is ordinary", () => {
    const highEntropy = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    const result = redactUrlEndpoint(`https://api.example.org/v1?auth=${highEntropy}`);
    expect(result.hadSecret).toBe(true);
    expect(result.endpoint).not.toContain(highEntropy);
  });

  it("Non-sensitive query parameters unchanged", () => {
    const result = redactUrlEndpoint("https://api.example.org/data?region=seoul&year=2024&page=1");
    expect(result.hadSecret).toBe(false);
    expect(result.endpoint).toBe("https://api.example.org/data?region=seoul&year=2024&page=1");
  });

  it("Mixed secret and non-sensitive params, redact only secret, preserve rest", () => {
    const result = redactUrlEndpoint(`https://api.example.org/data?region=seoul&api_key=${SECRET}&year=2024`);
    expect(result.endpoint).not.toContain(SECRET);
    expect(result.endpoint).toContain("region=seoul");
    expect(result.endpoint).toContain("year=2024");
  });

  it("hostname/pathname preserved as-is", () => {
    const result = redactUrlEndpoint(`https://api.example.org/v1/data?api_key=${SECRET}`);
    expect(result.endpoint).toContain("api.example.org");
    expect(result.endpoint).toContain("/v1/data");
  });

  it("Without query parameters, untouched", () => {
    const result = redactUrlEndpoint("https://api.example.org/data");
    expect(result.hadSecret).toBe(false);
    expect(result.endpoint).toBe("https://api.example.org/data");
  });

  it("Unparseable value returned as-is (other places enforce https:// format)", () => {
    const result = redactUrlEndpoint("not-a-url");
    expect(result).toEqual({ endpoint: "not-a-url", hadSecret: false });
  });
});

describe("endpointHasRedactedSecret", () => {
  it("Detects redacted endpoint after restore (don't use placeholder as real value)", () => {
    const { endpoint } = redactUrlEndpoint(`https://api.example.org/data?api_key=${SECRET}`);
    expect(endpointHasRedactedSecret(endpoint)).toBe(true);
  });

  it("Original endpoint without secret returns false", () => {
    expect(endpointHasRedactedSecret("https://api.example.org/data?region=seoul")).toBe(false);
  });

  it("Normal query param value like common word ('REDACTED') not mistaken (#283 follow-up §3)", () => {
    expect(endpointHasRedactedSecret("https://api.example.org/data?status=REDACTED")).toBe(false);
  });
});

describe("urlHasUserinfo (#283 follow-up §4)", () => {
  it("Detects username:password@host format", () => {
    expect(urlHasUserinfo("https://username:password@api.example.org/data")).toBe(true);
  });

  it("Detects username only", () => {
    expect(urlHasUserinfo("https://username@api.example.org/data")).toBe(true);
  });

  it("If no userinfo, returns false", () => {
    expect(urlHasUserinfo("https://api.example.org/data?region=seoul")).toBe(false);
  });

  it("Unparseable value returns false", () => {
    expect(urlHasUserinfo("not-a-url")).toBe(false);
  });
});

describe("redactUrlEndpoint — userinfo credential removal (#283 follow-up §4)", () => {
  it("Completely removes username:password@host (deletes, not masks)", () => {
    const result = redactUrlEndpoint("https://username:password@api.example.org/data");
    expect(result.hadSecret).toBe(true);
    expect(result.endpoint).not.toContain("username");
    expect(result.endpoint).not.toContain("password");
    expect(result.endpoint).toBe("https://api.example.org/data");
  });
});

describe("sanitizeUrlEndpointForStorage (#283 follow-up §2, §4)", () => {
  it("Malformed value (unparseable by new URL()) returns empty — no secret saved", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const result = sanitizeUrlEndpointForStorage(`not-a-url?token=${secret}`);
    expect(result).toBe("");
  });

  it("URL with userinfo credential returns empty", () => {
    const result = sanitizeUrlEndpointForStorage("https://user:password@api.example.org/data");
    expect(result).toBe("");
  });

  it("Normal URL secret query params masked same as display redaction", () => {
    const secret = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";
    const result = sanitizeUrlEndpointForStorage(`https://api.example.org/data?api_key=${secret}`);
    expect(result).not.toContain(secret);
    expect(result).toContain("api.example.org");
  });

  it("Non-sensitive URL preserved as-is", () => {
    const result = sanitizeUrlEndpointForStorage("https://api.example.org/data?region=seoul");
    expect(result).toBe("https://api.example.org/data?region=seoul");
  });
});
