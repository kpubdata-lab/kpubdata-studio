/**
 * Users read the warehouse vocabulary — Source, Table, Snapshot, Refresh (studio#422).
 *
 * kpubdata docs/brand/TERMINOLOGY.md is canonical. Three of its rules can be checked on
 * the locale files, so they are:
 *
 * 1. "Artifact" is not a user term — it is a Snapshot or Snapshot File.
 * 2. "Dataset" never stands alone — Source Dataset for an origin, Table for an output.
 *    What remains legitimately are interpolation names (`{{dataset}}`), BuildSpec field
 *    paths (`sources[0].dataset`), code in backticks (the SQL relation `FROM dataset`)
 *    and Hugging Face's own `owner/dataset` wording.
 *
 * The same words are also checked where a screen writes them directly in TSX — JSX
 * text and the string props a user reads (label, title, placeholder …) — because the
 * locale check alone missed them (#485).
 *
 * 3. Creating a table is not a Refresh. In the two creation wizards "Refresh" may only
 *    mean refreshing a preview, or describe the edit mode that re-runs an existing spec.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { scanUiTexts } from "../scripts/hardcoded-ui-text.mjs";

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "i18n", "locales");

/** Keys whose "dataset" is Hugging Face's term for a publish destination, not ours. */
const HUGGING_FACE_KEYS = new Set(["buildPublish.privateLabel"]);
/**
 * Creation-wizard keys that do refresh an existing table: edit mode, and the choice to
 * build over a table that is already there instead of making a new one (#837).
 */
const EDIT_MODE_KEYS = new Set([
  "newBuild.page.eyebrowEdit",
  "newBuild.page.specEditing",
  "newBuild.review.runRefresh",
  "addData.review.existingChoiceRefresh",
]);

function flatten(tree: unknown, path = ""): [string, string][] {
  if (typeof tree === "string") return [[path, tree]];
  if (tree && typeof tree === "object") {
    return Object.entries(tree).flatMap(([key, value]) => flatten(value, path ? `${path}.${key}` : key));
  }
  return [];
}

function artifactMentions(entries: [string, string][]): string[] {
  return entries.filter(([, value]) => /\bartifacts?\b|산출물|결과물/i.test(value)).map(([key]) => key);
}

function bareDatasetMentions(entries: [string, string][]): string[] {
  return entries
    .filter(([key]) => !HUGGING_FACE_KEYS.has(key))
    .filter(([, value]) => {
      const text = value
        .replace(/`[^`]*`/g, "")
        .replace(/\{\{\s*\w+\s*\}\}/g, "")
        .replace(/\w*(\[\w*\])?\.dataset\b/g, "")
        .replace(/owner\/dataset/g, "");
      return /(?<!source )\bdatasets?\b|(?<!소스 )데이터셋/i.test(text);
    })
    .map(([key]) => key);
}

function refreshInCreation(entries: [string, string][]): string[] {
  return entries
    .filter(([key]) => /^(newBuild|addData)\./.test(key) && !EDIT_MODE_KEYS.has(key))
    .filter(([, value]) => /refresh|갱신/i.test(value) && !/preview|미리보기/i.test(value))
    .map(([key]) => key);
}

describe.each(["en", "ko"])("warehouse terminology gate (#422) — %s.json", (locale) => {
  const entries = flatten(JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), "utf8")));

  it("has no Artifact", () => expect(artifactMentions(entries)).toEqual([]));
  it("has no Dataset without a qualifier", () => expect(bareDatasetMentions(entries)).toEqual([]));
  it("never calls creating a table a Refresh", () => expect(refreshInCreation(entries)).toEqual([]));
});

describe("warehouse terminology gate — the checks fail when they should", () => {
  it("finds Artifact in either language", () => {
    expect(artifactMentions([["a", "Download artifacts"], ["b", "산출물 보기"], ["c", "Snapshot files"]])).toEqual(["a", "b"]);
  });

  it("finds a bare Dataset but not a qualified one or a field path", () => {
    expect(
      bareDatasetMentions([
        ["a", "Pick a dataset"],
        ["b", "데이터셋 목록"],
        ["c", "Pick a source dataset"],
        ["d", "소스 데이터셋 선택"],
        ["e", "sources[{{index}}].dataset: missing"],
        ["f", "{{dataset}} · {{run}} report"],
        ["g", "`FROM dataset` reads {{target}}."],
        ["h", "`SELECT 1` then pick a dataset"],
      ]),
    ).toEqual(["a", "b", "h"]);
  });

  it("finds Refresh on a creation screen but allows preview refresh and edit mode", () => {
    expect(
      refreshInCreation([
        ["newBuild.review.run", "Refresh"],
        ["addData.review.cta", "테이블 갱신"],
        ["newBuild.preview.refresh", "Refresh Preview"],
        ["newBuild.review.runRefresh", "Refresh"],
        ["builds.retry", "Refresh"],
      ]),
    ).toEqual(["newBuild.review.run", "addData.review.cta"]);
  });
});

/*
 * Hard-coded screen text (#485).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// "Builder" left this list in #510: it is the product name again (KPubData Builder).
const OLD_TERM = /\b(Artifacts?|Builds?)\b|(?<![Ss]ource )\b[Dd]atasets?\b/;
const SHOWN_PROP = /\b(label|title|eyebrow|description|sub|placeholder|aria-label|alt|actionLabel|heading)="([^"]*)"/g;
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;

/** `file:line: text` for every old term a user would read in this source. */
function hardCodedOldTerms(file: string, source: string): string[] {
  const hits: string[] = [];
  source.split("\n").forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const texts = [...line.matchAll(SHOWN_PROP)].map((m) => m[2]).concat([...line.matchAll(JSX_TEXT)].map((m) => m[1]));
    for (const text of texts) {
      if (OLD_TERM.test(text.replace(/owner\/dataset/g, ""))) hits.push(`${file}:${index + 1}: ${text.trim()}`);
    }
  });
  return hits;
}

describe("warehouse terminology gate — hard-coded TSX text (#485)", () => {
  it("no screen writes an old term directly", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => file.endsWith(".tsx") && !file.includes(".test."));
    const hits = files.flatMap((file) => hardCodedOldTerms(file, readFileSync(join(ROOT, file), "utf8")));
    expect(hits).toEqual([]);
  });

  it("finds an old term in JSX text and in a shown prop, but not in code or Hugging Face's owner/dataset", () => {
    const source = [
      '<th className="px-5 py-3">Build</th>',
      '<Card title="Artifacts" />',
      '<input placeholder="owner/dataset" />',
      "const builderApi = useBuilder();",
      '<p className="x">{t("run")}</p>',
    ].join("\n");
    expect(hardCodedOldTerms("f.tsx", source)).toEqual(["f.tsx:1: Build", "f.tsx:2: Artifacts"]);
  });
});

/*
 * Product names on screen (#531): the AI entry is "Ask KPubData" — never the retired
 * standalone label — the old "Kubi" and "Refresh Jobs" are gone, and the Builder is "KPubData
 * Builder" wherever a screen writes it directly. Locale values are checked for the first
 * three (the AI label also in lower case and Korean, #572); "the Builder" in a locale
 * sentence, after the full name, stays allowed. The TSX text comes from the same scanner
 * as the hard-coded English gate, with no exemptions.
 */

// stale-ui-ignore: the retired AI label this test checks is gone (#531).
const RETIRED_AI_LABEL = "Assistant";
const RETIRED_NAME = new RegExp(`\\bKubi\\b|\\b${RETIRED_AI_LABEL}\\b|\\bRefresh Jobs\\b`);
const BARE_BUILDER = /(?<!KPubData )\bBuilder\b/;
/**
 * In a locale value the retired label is also caught in lower case and in Korean (#572):
 * "ask the assistant", or the Korean transliteration. Keys and identifiers
 * (`assistantChat.title`, `openAssistant`) are code and keep the word; only the text a person reads is checked.
 */
const RETIRED_NAME_IN_VALUE = /\bassistants?\b|어시스턴트/i;

function retiredNames(entries: [string, string][]): string[] {
  return entries
    .filter(([, value]) => RETIRED_NAME.test(value) || RETIRED_NAME_IN_VALUE.test(value))
    .map(([key]) => key);
}

function productNameHits(texts: { file: string; line: number; text: string }[]): string[] {
  return texts
    .filter(({ text }) => RETIRED_NAME.test(text) || BARE_BUILDER.test(text))
    .map(({ file, line, text }) => `${file}:${line}: ${text}`);
}

describe("product names on screen (#531)", () => {
  it.each(["en", "ko"])("%s.json has no retired product name", (locale) => {
    const entries = flatten(JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), "utf8")));
    expect(retiredNames(entries)).toEqual([]);
  });

  it("no screen writes a retired product name or a bare Builder in TSX text", () => {
    expect(productNameHits(scanUiTexts(join(ROOT, "src")))).toEqual([]);
  });

  it("finds them in TSX text but allows KPubData Builder and Ask KPubData", () => {
    const texts = [
      ["a", RETIRED_AI_LABEL],
      ["b", "Kubi 에게 묻기"],
      ["c", "Refresh Jobs"],
      ["d", "Builder readiness"],
      ["e", "KPubData Builder readiness"],
      ["f", "Ask KPubData"],
    ].map(([file, text]) => ({ file, line: 1, text }));
    expect(productNameHits(texts)).toEqual([`a:1: ${RETIRED_AI_LABEL}`, "b:1: Kubi 에게 묻기", "c:1: Refresh Jobs", "d:1: Builder readiness"]);
    expect(retiredNames([["k", RETIRED_AI_LABEL], ["l", "Ask KPubData"]])).toEqual(["k"]);
  });

  it("finds the retired label in a locale value in lower case and in Korean, but not in a key", () => {
    expect(
      retiredNames([
        ["validate.desc", "Ask the assistant for suggested fixes."],
        ["chat.title", "스펙 어시스턴트"],
        ["assistantChat.needsKey", "Ask KPubData 를 사용하려면 LLM API 키를 입력하세요."],
        ["openAssistant", "Open Ask KPubData"],
      ]),
    ).toEqual(["validate.desc", "chat.title"]);
  });
});
