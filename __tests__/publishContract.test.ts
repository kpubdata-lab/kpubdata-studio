import { describe, expect, it } from "vitest";
import {
  publishHuggingFaceOptionsSchema,
  publishReadinessResponseSchema,
  publishRequestSchema,
  publishResponseSchema,
  publishTargetSchema,
} from "@/shared/lib/builderApi.schema";

describe("Builder PR #547 OpenAPI publish shape", () => {
  it("exposes only the HTTP-supported huggingface target", () => {
    expect(publishTargetSchema.parse("huggingface")).toBe("huggingface");
    expect(() => publishTargetSchema.parse("kaggle")).toThrow();
    expect(() => publishTargetSchema.parse("local")).toThrow();
  });

  it("matches readiness required fields and tolerates additive fields (#497)", () => {
    const fixture = {
      run_id: "run-270",
      target: "huggingface",
      ready: false,
      blockers: [{ code: "license_missing", message: "license required" }],
      warnings: [{ code: "notice", message: "review" }],
    };
    expect(publishReadinessResponseSchema.parse(fixture)).toEqual(fixture);
    // An Builder-added field is stripped, not rejected (#497)…
    expect(publishReadinessResponseSchema.parse({ ...fixture, destination: "owner/data" })).toEqual(fixture);
    // …but a missing required field still fails.
    const { ready: _ready, ...withoutReady } = fixture;
    expect(() => publishReadinessResponseSchema.parse(withoutReady)).toThrow();
  });

  it("defaults private=true and rejects unknown request/options fields", () => {
    expect(publishHuggingFaceOptionsSchema.parse({})).toEqual({ private: true });
    expect(publishRequestSchema.parse({ target: "huggingface", destination: "owner/data" })).toEqual({ target: "huggingface", destination: "owner/data" });
    expect(() => publishRequestSchema.parse({ target: "huggingface", destination: "owner/data", token: "secret" })).toThrow();
    expect(() => publishRequestSchema.parse({ target: "huggingface", destination: "owner/data", options: { private: true, overwrite: true } })).toThrow();
  });

  it("keeps only the modelled 200 response fields and requires reference", () => {
    const fixture = {
      run_id: "run-270",
      target: "huggingface",
      publisher: "huggingface",
      destination: "owner/data",
      reference: "https://huggingface.co/datasets/owner/data",
      artifact_count: 2,
      status: "ok",
    };
    expect(publishResponseSchema.parse(fixture)).toEqual(fixture);
    // Additive field: stripped, not a parse failure (#497).
    expect(publishResponseSchema.parse({ ...fixture, version: "v1" })).toEqual(fixture);
    const { reference: _reference, ...withoutReference } = fixture;
    expect(() => publishResponseSchema.parse(withoutReference)).toThrow();
  });
});
