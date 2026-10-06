/**
 * An uploaded file's retention date (#758, builder#1047).
 *
 * In a multi-user deployment Builder deletes an upload once it is older than the retention
 * period, and a spec that names it then fails to build. Builder says when in the upload's
 * metadata (`expires_at`, contract 1.86.0); these pin how Studio reads it.
 */
import { describe, expect, it } from "vitest";

import { uploadExpiry } from "@/features/add-data/model";
import { uploadMetadataSchema } from "@/shared/lib/builderApi.schema";

const NOW = Date.parse("2026-10-06T00:00:00Z");
const META = {
  upload_id: `upl_${"0".repeat(32)}`,
  format: "csv",
  encoding: "utf-8",
  size_bytes: 1,
  original_filename: "a.csv",
  created_at: "2026-10-01T00:00:00+00:00",
};

describe("uploadExpiry", () => {
  it("is pending before the date and expired from it on", () => {
    expect(uploadExpiry("2026-10-07T00:00:00+00:00", NOW)).toBe("pending");
    expect(uploadExpiry("2026-10-06T00:00:00+00:00", NOW)).toBe("expired");
    expect(uploadExpiry("2026-10-05T23:59:59+00:00", NOW)).toBe("expired");
  });

  it.each([[null], [undefined], [""], ["not a date"]])("is none when Builder named no date (%s)", (value) => {
    expect(uploadExpiry(value, NOW)).toBe("none");
  });
});

describe("upload metadata", () => {
  it("carries the date Builder sends", () => {
    const parsed = uploadMetadataSchema.parse({ ...META, expires_at: "2026-10-31T00:00:00+00:00" });
    expect(parsed.expires_at).toBe("2026-10-31T00:00:00+00:00");
  });

  it("accepts null: nothing will delete the upload", () => {
    expect(uploadMetadataSchema.parse({ ...META, expires_at: null }).expires_at).toBeNull();
  });

  it("accepts a Builder older than the field", () => {
    expect(uploadMetadataSchema.parse(META).expires_at).toBeUndefined();
  });
});
