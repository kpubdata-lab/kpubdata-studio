/**
 * A run's failure words on the administration screen (#906): every code and stage Builder
 * names (contract 1.116.0) has a label and a recovery hint in both languages, and anything
 * else reads as unknown rather than as Builder's raw value.
 */
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "@/shared/i18n";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";
import { RUN_FAILURE_CODES, RUN_FAILURE_STAGES, runFailureWords } from "./runFailure";

const t = i18n.t.bind(i18n);

afterEach(async () => {
  await i18n.changeLanguage("ko");
});

describe("locale entries", () => {
  it.each([
    ["en", en],
    ["ko", ko],
  ] as const)("%s has a label and a hint for every code, and a label for every stage", (_lang, locale) => {
    const failure = locale.admin.failure as {
      code: Record<string, string>;
      hint: Record<string, string>;
      stage: Record<string, string>;
    };
    expect(Object.keys(failure.code).sort()).toEqual([...RUN_FAILURE_CODES].sort());
    expect(Object.keys(failure.hint).sort()).toEqual([...RUN_FAILURE_CODES].sort());
    expect(Object.keys(failure.stage).sort()).toEqual([...RUN_FAILURE_STAGES].sort());
    for (const value of [...Object.values(failure.code), ...Object.values(failure.hint), ...Object.values(failure.stage)]) {
      expect(value.trim()).not.toBe("");
    }
  });
});

describe("runFailureWords", () => {
  it("says nothing for a run that did not fail and has no code", () => {
    expect(runFailureWords(t, { status: "succeeded" })).toBeNull();
    expect(runFailureWords(t, { status: "running", error_code: null, error_stage: null })).toBeNull();
  });

  it("words a known code, its stage and the owner's next step", async () => {
    await i18n.changeLanguage("en");
    const words = runFailureWords(t, { status: "failed", error_code: "application_required", error_stage: "bronze" });
    expect(words).toEqual({
      code: "Application required",
      stage: "Bronze",
      hint: en.admin.failure.hint.application_required,
      known: true,
    });
  });

  it("follows the language", async () => {
    await i18n.changeLanguage("ko");
    const words = runFailureWords(t, { status: "failed", error_code: "interrupted", error_stage: "started" });
    expect(words?.code).toBe(ko.admin.failure.code.interrupted);
    expect(words?.stage).toBe(ko.admin.failure.stage.started);
    expect(words?.hint).toBe(ko.admin.failure.hint.interrupted);
  });

  it("calls a failed run without a code unknown, with no hint", async () => {
    await i18n.changeLanguage("en");
    expect(runFailureWords(t, { status: "failed", error_code: null, error_stage: null })).toEqual({
      code: "Unknown cause",
      stage: "Stage unknown",
      hint: null,
      known: false,
    });
    expect(runFailureWords(t, { status: "cancelled" })?.known).toBe(false);
  });

  it("calls a code or stage it does not know unknown, never Builder's raw value", async () => {
    await i18n.changeLanguage("en");
    const words = runFailureWords(t, { status: "failed", error_code: "brand_new_code", error_stage: "brand_new_stage" });
    expect(words).toEqual({ code: "Unknown cause", stage: "Stage unknown", hint: null, known: false });
    expect(JSON.stringify(words)).not.toContain("brand_new");
  });

  it("keeps a known code when only the stage is unknown", async () => {
    await i18n.changeLanguage("en");
    const words = runFailureWords(t, { status: "failed", error_code: "rate_limited", error_stage: null });
    expect(words?.known).toBe(true);
    expect(words?.stage).toBe("Stage unknown");
  });
});
