/**
 * Every publish blocker code has a localized message and next step (#644).
 *
 * The codes come from the Builder contract's `PublishIssue.code` `x-codes` when
 * `BUILDER_CONTRACT` points at it (CI checks out Builder's main, as for the drift test),
 * and from Studio's checked-in `PUBLISH_ISSUE_CODES` otherwise. With the contract, the
 * checked-in list must also equal it, so a code Builder adds fails here until Studio
 * describes it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  PUBLISH_ISSUE_CODES,
  REDISTRIBUTION_ISSUE_CODES,
  describePublishIssue,
} from "@/features/publish/issues";
import { i18n } from "@/shared/i18n";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";

type Locale = { publish?: { issues?: Record<string, { message?: unknown; action?: unknown } | undefined> } };

const contractPath = process.env.BUILDER_CONTRACT;

function contractCodes(path: string): string[] {
  const contract = parse(readFileSync(path, "utf-8")) as {
    components: { schemas: { PublishIssue: { properties: { code: { "x-codes": Record<string, string> } } } } };
  };
  return Object.keys(contract.components.schemas.PublishIssue.properties.code["x-codes"]);
}

/** `lang:code.field` for every code whose message or next step is missing or empty. */
function missingEntries(codes: readonly string[], locales: Record<string, Locale>): string[] {
  const missing: string[] = [];
  for (const [lang, locale] of Object.entries(locales)) {
    for (const code of codes) {
      const entry = locale.publish?.issues?.[code];
      for (const field of ["message", "action"] as const) {
        const value = entry?.[field];
        if (typeof value !== "string" || value.trim() === "") missing.push(`${lang}:${code}.${field}`);
      }
    }
  }
  return missing;
}

const codes: readonly string[] = contractPath ? contractCodes(contractPath) : PUBLISH_ISSUE_CODES;

describe("publish issue codes (#644)", () => {
  it("covers the contract's 22 codes", () => {
    expect(codes).toHaveLength(22);
    if (contractPath) expect([...PUBLISH_ISSUE_CODES].sort()).toEqual([...codes].sort());
  });

  it("has a ko and an en message and next step for every code", () => {
    expect(missingEntries(codes, { ko, en })).toEqual([]);
  });

  it("fails when a code's message is missing in one language", () => {
    const { license_missing: _dropped, ...rest } = ko.publish.issues;
    const broken = { ...ko, publish: { ...ko.publish, issues: rest } };
    expect(missingEntries(codes, { ko: broken, en })).toEqual(["ko:license_missing.message", "ko:license_missing.action"]);
    expect(missingEntries(["not_a_code"], { en })).toEqual(["en:not_a_code.message", "en:not_a_code.action"]);
  });

  it("gives each code its own sentence, not the generic one", () => {
    const generic = describePublishIssue({ code: "zz_unknown" }).message;
    const messages = codes.map((code) => describePublishIssue({ code }));
    expect(messages.every((described) => described.known)).toBe(true);
    expect(messages.filter((described) => described.message === generic)).toEqual([]);
    expect(new Set(messages.map((described) => described.message)).size).toBe(codes.length);
  });

  it("shows an unknown code as a generic blocker that names it", () => {
    const described = describePublishIssue({ code: "source_key_path_collision" });
    expect(described.known).toBe(false);
    expect(described.message).toContain("source_key_path_collision");
    expect(described.link).toBeUndefined();
  });

  it("points license_missing at the spec editor and run failures at the run", () => {
    expect(describePublishIssue({ code: "license_missing" })).toMatchObject({ known: true, link: "editSpec" });
    expect(describePublishIssue({ code: "run_failed" }).link).toBe("openRun");
    expect(describePublishIssue({ code: "artifact_missing" }).link).toBe("openArtifacts");
  });

  it("localizes in both languages", async () => {
    const before = i18n.language;
    try {
      await i18n.changeLanguage("en");
      expect(describePublishIssue({ code: "license_missing" }).message).toBe(en.publish.issues.license_missing.message);
      await i18n.changeLanguage("ko");
      expect(describePublishIssue({ code: "license_missing" }).message).toBe(ko.publish.issues.license_missing.message);
    } finally {
      await i18n.changeLanguage(before);
    }
  });

  it("marks the six redistribution codes", () => {
    expect([...REDISTRIBUTION_ISSUE_CODES].sort()).toEqual([
      "destination_public",
      "destination_visibility_unknown",
      "non_commercial_marker_missing",
      "non_commercial_unconfirmed",
      "redistribution_forbidden",
      "redistribution_unknown",
    ]);
  });
});
