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
 * 3. Creating a table is not a Refresh. In the two creation wizards "Refresh" may only
 *    mean refreshing a preview, or describe the edit mode that re-runs an existing spec.
 */

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
