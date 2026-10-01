/**
 * Every publish blocker code has a localized message and next step (#644).
 *
 * The codes are Studio's checked-in `PUBLISH_ISSUE_CODES`. Against Builder's contract
 * (`BUILDER_CONTRACT`), the same checks run in `src/shared/lib/contractDrift.test.ts`,
 * which CI's `Builder contract drift` job runs against Builder's main: there the list
 * must equal the contract's `x-codes`, and every contract code needs a ko and en entry.
 * When `BUILDER_CONTRACT` is set here too, this file checks the contract's codes.
 */
import { describe, expect, it } from "vitest";
import {
  PUBLISH_ISSUE_CODES,
  REDISTRIBUTION_ISSUE_CODES,
  describePublishIssue,
} from "@/features/publish/issues";
import { i18n } from "@/shared/i18n";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";
import { contractIssueCodes, contractIssueCodesOf, issueCodeDrift, missingIssueEntries } from "./support/publishIssueCoverage";

const contractPath = process.env.BUILDER_CONTRACT;
const missingEntries = missingIssueEntries;
const codes: readonly string[] = contractPath ? contractIssueCodes(contractPath) : PUBLISH_ISSUE_CODES;

describe("publish issue codes (#644)", () => {
  it("lists each code once, and the contract's codes when it is given", () => {
    expect(new Set(PUBLISH_ISSUE_CODES).size).toBe(PUBLISH_ISSUE_CODES.length);
    expect(PUBLISH_ISSUE_CODES.length).toBeGreaterThan(0);
    if (contractPath) expect(issueCodeDrift(PUBLISH_ISSUE_CODES, codes)).toEqual([]);
  });

  it("reports a code the contract adds or drops", () => {
    expect(issueCodeDrift(["a", "b"], ["a", "b"])).toEqual([]);
    expect(issueCodeDrift(["a"], ["a", "card_missing"])).toEqual(["+card_missing"]);
    expect(issueCodeDrift(["a", "old"], ["a"])).toEqual(["-old"]);
    const contract = { components: { schemas: { PublishIssue: { properties: { code: { "x-codes": { a: "x", b: "y" } } } } } } };
    expect(contractIssueCodesOf(contract)).toEqual(["a", "b"]);
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
