/**
 * Public API sourceParams secret redaction (#283 follow-up §1).
 *
 * Verifies contract reusing existing detector from `features/assistant/scrub.ts`
 * (`isSecretKey`/`looksLikeSecret`) — judge only per key/value unit. Don't
 * reinvent secret detection regex here.
 */
import { describe, expect, it } from "vitest";
import {
  PARAMS_REDACTED_SENTINEL,
  jsonValueHasRedactedSecret,
  redactSourceParamsObject,
  redactSourceParamsText,
  sourceParamsHasRedactedSecret,
} from "./paramsRedaction";

const SECRET = "A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB";

describe("redactSourceParamsObject", () => {
  it("serviceKey value replaced with sentinel", () => {
    const result = redactSourceParamsObject({ page: "1", serviceKey: SECRET });
    expect(result.hadSecret).toBe(true);
    expect(result.params.serviceKey).toBe(PARAMS_REDACTED_SENTINEL);
    expect(result.params.page).toBe("1");
  });

  it("api_key value replaced with sentinel, non-sensitive value (region) preserved", () => {
    const result = redactSourceParamsObject({ api_key: SECRET, region: "seoul" });
    expect(result.params.api_key).toBe(PARAMS_REDACTED_SENTINEL);
    expect(result.params.region).toBe("seoul");
  });

  it("High-entropy value redacted even if key name is ordinary", () => {
    const highEntropy = "Zx8pQ2vR7mK4nL9wT1yB6cU3sD0fH5jA8gE2rN7iM4x";
    const result = redactSourceParamsObject({ auth: highEntropy });
    expect(result.hadSecret).toBe(true);
    expect(result.params.auth).toBe(PARAMS_REDACTED_SENTINEL);
  });

  it("Only non-sensitive parameters, untouched", () => {
    const result = redactSourceParamsObject({ region: "seoul", year: "2024" });
    expect(result.hadSecret).toBe(false);
    expect(result.params).toEqual({ region: "seoul", year: "2024" });
  });

  it("Normal value coincidentally like sentinel ('REDACTED') preserved as-is (#283 follow-up §3)", () => {
    const result = redactSourceParamsObject({ status: "REDACTED" });
    expect(result.hadSecret).toBe(false);
    expect(result.params.status).toBe("REDACTED");
  });
});

describe("redactSourceParamsText", () => {
  it("If JSON parses, redact only secret values, preserve rest of text structure", () => {
    const result = redactSourceParamsText(JSON.stringify({ page: 1, serviceKey: SECRET }));
    expect(result.hadSecret).toBe(true);
    expect(result.text).not.toContain(SECRET);
    expect(result.text).toContain("\"page\": 1");
  });

  it("If no secret, return original text as-is (no format change)", () => {
    const raw = '{"region":"seoul"}';
    const result = redactSourceParamsText(raw);
    expect(result.hadSecret).toBe(false);
    expect(result.text).toBe(raw);
  });

  it("Empty string left as-is", () => {
    expect(redactSourceParamsText("")).toEqual({ text: "", hadSecret: false });
  });

  it("Unparseable value as JSON, fail-closed as sentinel entirely", () => {
    const malformed = `{not json, token=${SECRET}`;
    const result = redactSourceParamsText(malformed);
    expect(result.hadSecret).toBe(true);
    expect(result.text).not.toContain(SECRET);
    expect(result.text).toBe(PARAMS_REDACTED_SENTINEL);
  });
});

describe("sourceParamsHasRedactedSecret", () => {
  it("Detects sourceParams with leftover sentinel", () => {
    const { text } = redactSourceParamsText(JSON.stringify({ serviceKey: SECRET }));
    expect(sourceParamsHasRedactedSecret(text)).toBe(true);
  });

  it("Original without secret returns false", () => {
    expect(sourceParamsHasRedactedSecret('{"region":"seoul"}')).toBe(false);
  });

  it("Detects all persistence boundary markers (S07 review §1)", () => {
    // Draft redaction sentinel
    expect(sourceParamsHasRedactedSecret('{"serviceKey":"__KPD_PARAMS_SECRET_REDACTED__"}')).toBe(true);
    // URL query redaction placeholder
    expect(sourceParamsHasRedactedSecret("https://x/y?serviceKey=__KPD_URL_SECRET_REDACTED__")).toBe(true);
    // redactSecrets() terminal marker (specStore/savedSpecs)
    expect(sourceParamsHasRedactedSecret('{"serviceKey":"[REDACTED]"}')).toBe(true);
    // scrub internal placeholder
    expect(sourceParamsHasRedactedSecret('{"k":"__SCRUBBED_abc_0__"}')).toBe(true);
  });

  it("Bare 'REDACTED' (no brackets) treated as normal value, stays false", () => {
    expect(sourceParamsHasRedactedSecret('{"status":"REDACTED"}')).toBe(false);
  });
});

describe("jsonValueHasRedactedSecret", () => {
  it("nested object/array 어디에 있든 4종 marker를 모두 감지한다 (S07 리뷰 §1)", () => {
    expect(jsonValueHasRedactedSecret({ sources: [{ params: { serviceKey: "[REDACTED]" } }] })).toBe(true);
    expect(jsonValueHasRedactedSecret({ a: { b: ["__KPD_PARAMS_SECRET_REDACTED__"] } })).toBe(true);
    expect(jsonValueHasRedactedSecret({ endpoint: "https://x?k=__KPD_URL_SECRET_REDACTED__" })).toBe(true);
    expect(jsonValueHasRedactedSecret({ note: "__SCRUBBED_r_1__" })).toBe(true);
  });

  it("정상 BuildSpec 형태는 false", () => {
    expect(
      jsonValueHasRedactedSecret({
        datasetId: "air",
        sources: [{ provider: "datago", dataset: "air", params: { region: "11", status: "REDACTED" } }],
        metadata: { outputPath: "artifacts/builds/air" },
      }),
    ).toBe(false);
  });
});
