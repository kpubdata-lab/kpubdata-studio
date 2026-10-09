/**
 * The Korean screen's words (#843): the detector finds what it should, the locales are
 * clean by it, the glossary document matches its table, and Builder's codes reach the
 * screen as words.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { KO_GLOSSARY, issueReferences, mixedTerms } from "../scripts/ko-mixed-terms.mjs";
import { i18n } from "@/shared/i18n";
import { codeLabel, runStatusLabel } from "@/shared/i18n/codeLabels";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";
import { BUILDER_ENUMS } from "@/shared/lib/builderEnums";

const HERE = dirname(fileURLToPath(import.meta.url));

afterEach(async () => {
  await i18n.changeLanguage("ko");
});

describe("the mixed-term detector", () => {
  it("reports a glossary word written in English inside a Korean sentence", () => {
    const found = mixedTerms({ a: { b: "이 Run의 Provider를 확인하세요." } });

    expect(found).toEqual([
      { key: "a.b", word: "Run", korean: "실행" },
      { key: "a.b", word: "Provider", korean: "제공자" },
    ]);
  });

  it("leaves codes, paths, placeholders, tags and English-only values alone", () => {
    const found = mixedTerms({
      code: "run_id로 조회했습니다.",
      path: "sources[{{index}}].provider: 없는 값입니다.",
      placeholder: "{{run}} 실행을 열었습니다.",
      backticks: "`stage` 필드가 필요합니다.",
      parameter: "실행 상세(/refresh-jobs?run=...)에서 제공됩니다.",
      tag: "<run>열기</run> 버튼",
      english: "Run details",
    });

    expect(found).toEqual([]);
  });

  it("reads a word joined by a slash as prose next to Hangul or another term, and as a path otherwise", () => {
    const found = mixedTerms({
      table: "현재 테이블/Run을 분석합니다.",
      pair: "선택된 source/stage가 아닙니다.",
      path: "GET admin/runs 와 metadata/sources 를 씁니다.",
    });

    expect(found.map(({ key, word }) => `${key}:${word}`)).toEqual(["table:Run", "pair:source", "pair:stage"]);
  });

  it("reports an issue number in a user string, in either language", () => {
    expect(
      issueReferences({
        ko: { a: "단계 진행(#488)의 판정입니다." },
        en: { a: "Stage progress (#488)", b: "{{count}}건", c: "Use &#123; here" },
      }),
    ).toEqual([
      { lang: "ko", key: "a", ref: "#488" },
      { lang: "en", key: "a", ref: "#488" },
    ]);
  });

  it("finds nothing in Studio's locales", () => {
    expect(mixedTerms(ko)).toEqual([]);
    expect(issueReferences({ ko, en })).toEqual([]);
  });

  it("fails the CLI on an issue reference and passes it on these locales", () => {
    const out = execFileSync("node", [join(HERE, "..", "scripts", "ko-mixed-terms.mjs")], {
      encoding: "utf8",
    });

    expect(out).toContain("Issue references in user strings: 0 (baseline 0).");
  });

  it("exits 1 when a user string carries an issue number, and only warns on a mixed word", () => {
    const dir = mkdtempSync(join(tmpdir(), "ko-terms-"));
    try {
      const script = join(HERE, "..", "scripts", "ko-mixed-terms.mjs");
      const write = (ko: object, en: object) => {
        writeFileSync(join(dir, "ko.json"), JSON.stringify(ko));
        writeFileSync(join(dir, "en.json"), JSON.stringify(en));
      };

      write({ a: "이 Run을 엽니다." }, { a: "Open this run." });
      const warned = execFileSync("node", [script, "--locales", dir, "--github"], { encoding: "utf8" });
      expect(warned).toContain("::warning title=English word in a Korean string (#843)::a: \"Run\"");

      write({ a: "단계 진행(#488)입니다." }, { a: "Stage progress" });
      let status = 0;
      let out = "";
      try {
        execFileSync("node", [script, "--locales", dir, "--github"], { encoding: "utf8", stdio: "pipe" });
      } catch (error) {
        const failed = error as { status?: number; stdout?: string };
        status = failed.status ?? -1;
        out = failed.stdout ?? "";
      }
      expect(status).toBe(1);
      expect(out).toContain("::error title=Issue number in a user string (#843)::ko a: issue reference #488");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches the glossary document word for word", () => {
    const doc = readFileSync(join(HERE, "..", "docs", "ko-glossary.md"), "utf8");
    const rows = [...doc.matchAll(/^\| ([a-z]+) \| (.+?) \|$/gm)].map((m): [string, string] => [m[1]!, m[2]!]);

    expect(new Map(rows)).toEqual(KO_GLOSSARY);
  });
});

describe("Builder's codes on the screen", () => {
  const groups = {
    event: BUILDER_ENUMS.BuildEventName,
    eventStatus: BUILDER_ENUMS.BuildEventStatus,
    eventStage: BUILDER_ENUMS.BuildEventStageName,
    stageStatus: BUILDER_ENUMS.StageStatusValue,
  } as const;

  it.each(Object.entries(groups))("words every %s code in both languages", async (group, codes) => {
    for (const lang of ["ko", "en"]) {
      await i18n.changeLanguage(lang);
      for (const code of codes) {
        const label = codeLabel(i18n.t, group as keyof typeof groups, code);
        expect(label, `${lang} ${group}.${code}`).not.toBe(`codes.${group}.${code}`);
        if (lang === "ko" && group !== "eventStage") expect(label, `${group}.${code}`).toMatch(/[가-힣]/);
      }
    }
  });

  it("shows a code the contract does not declare as Builder sent it", () => {
    expect(codeLabel(i18n.t, "event", "run_paused")).toBe("run_paused");
    expect(runStatusLabel(i18n.t, "interrupted")).toBe("interrupted");
  });

  it("words a run's status, a summary's ok included, in the current language", async () => {
    expect(runStatusLabel(i18n.t, "ok")).toBe("성공");
    expect(runStatusLabel(i18n.t, "failed")).toBe("실패");
    await i18n.changeLanguage("en");
    expect(runStatusLabel(i18n.t, "ok")).toBe(i18n.t("status.succeeded"));
    expect(codeLabel(i18n.t, "stageStatus", "not_run")).toBe("Not run");
  });
});
