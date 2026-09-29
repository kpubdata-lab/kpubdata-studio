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

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "i18n", "locales");

/** Keys whose "dataset" is Hugging Face's term for a publish destination, not ours. */
const HUGGING_FACE_KEYS = new Set(["buildPublish.privateLabel"]);
/** Creation-wizard keys that describe edit mode, which does refresh an existing table. */
const EDIT_MODE_KEYS = new Set(["newBuild.page.eyebrowEdit", "newBuild.page.specEditing", "newBuild.review.runRefresh"]);

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
// Builder is the product name again and Engine the stale one (#510).
const OLD_TERM = /\b(Artifacts?|Engine|Builds?)\b|(?<![Ss]ource )\b[Dd]atasets?\b/;
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
      '<h3 className="x">Engine API</h3>',
      '<h3 className="x">Builder API</h3>',
      '<input placeholder="owner/dataset" />',
      "const builderApi = useBuilder();",
      '<p className="x">{t("run")}</p>',
    ].join("\n");
    expect(hardCodedOldTerms("f.tsx", source)).toEqual(["f.tsx:1: Build", "f.tsx:2: Artifacts", "f.tsx:3: Engine API"]);
  });
});
