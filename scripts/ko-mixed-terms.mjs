/**
 * English words the Korean screen has a word for, and issue numbers in user strings (#843).
 *
 * The key gate (`check-i18n-keys.mjs`) reports a ko value that is wholly English; it
 * cannot see a Korean sentence with "run", "provider" or "stage" left in it. This reads
 * every ko value that has Hangul and reports two things:
 *
 *   1. A word from `KO_GLOSSARY` written in English — "이 Run의" where the glossary says
 *      "실행". A warning: some uses are deliberate (a quoted field name, a product
 *      name), and the screen still works. CI prints each as a `::warning::`.
 *   2. An issue reference — `(#488)` or `#250` — in a ko or en value. A user does not
 *      know what #488 is. This fails: the baseline is zero.
 *
 * `{{placeholders}}`, `` `code` ``, `<tags>` and URLs are not read: they are not words
 * the user reads as prose. A word joined to `_`, `.`, `[` or `-` is part of a code or a
 * path (`run_id`, `sources[0]`) and is not reported; neither is a word followed by `=`,
 * which names a parameter (`/refresh-jobs?run=...`). A word joined by `/` is prose when
 * the other side is Hangul or another glossary word, or the word is capitalized
 * ("테이블/Run", "source/stage"), and a path otherwise (`admin/runs`).
 *
 * Usage:
 *   node scripts/ko-mixed-terms.mjs            # report; exit 1 on an issue reference
 *   node scripts/ko-mixed-terms.mjs --github   # the same, with ::warning:: annotations
 *   node scripts/ko-mixed-terms.mjs --locales D  # read ko.json and en.json from D (tests)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The screen glossary: an English word and the Korean word the ko screen uses for it.
 * Kept English on purpose, and so not listed: product and format names (KPubData,
 * Builder, Studio, BuildSpec, Ask KPubData), standard abbreviations (API, ID, SQL, URL,
 * JSON, YAML, LLM, AI, HTTPS, OIDC) and the stage names Bronze, Silver and Gold.
 */
export const KO_GLOSSARY = new Map([
  ["run", "실행"],
  ["provider", "제공자"],
  ["source", "소스"],
  ["stage", "단계"],
  ["credential", "자격 증명"],
  ["quality", "품질"],
  ["preview", "미리보기"],
  ["evidence", "근거"],
  ["event", "이벤트"],
  ["timeline", "타임라인"],
  ["snapshot", "스냅샷"],
  ["schema", "스키마"],
  ["query", "질의"],
  ["catalog", "카탈로그"],
  ["manifest", "매니페스트"],
  ["destination", "게시 위치"],
  ["workspace", "작업대"],
]);

const HANGUL = /[가-힣]/;
const NOT_PROSE = /\{\{[^}]*\}\}|`[^`]*`|<[^>]+>|https?:\/\/\S+/g;
const WORD = new RegExp(
  String.raw`(?<![A-Za-z_.#\[-])(${[...KO_GLOSSARY.keys()].join("|")})s?(?![A-Za-z_.\[=-])`,
  "gi",
);

/** Whether a word next to a `/` is prose ("테이블/Run") rather than a path (`admin/runs`). */
function slashProse(text, start, end, word) {
  const sides = [];
  if (text[start - 1] === "/") sides.push(/([A-Za-z]+|[가-힣]+)$/.exec(text.slice(0, start - 1))?.[1] ?? "");
  if (text[end] === "/") sides.push(/^([A-Za-z]+|[가-힣]+)/.exec(text.slice(end + 1))?.[1] ?? "");
  if (sides.length === 0 || /^[A-Z]/.test(word)) return true;
  return sides.every((side) => HANGUL.test(side[0] ?? "") || KO_GLOSSARY.has(side.toLowerCase().replace(/s$/, "")));
}
const ISSUE_REF = /(?<![A-Za-z0-9&])#\d{2,}\b/g;

/** Every string value of a locale tree, keyed by its dotted path. */
export function flatten(tree, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else if (value && typeof value === "object") flatten(value, path, out);
  }
  return out;
}

/** Glossary words written in English inside Korean values: `{key, word, korean}`. */
export function mixedTerms(ko) {
  const found = [];
  for (const [key, value] of flatten(ko)) {
    if (!HANGUL.test(value)) continue;
    const prose = value.replace(NOT_PROSE, " ");
    for (const match of prose.matchAll(WORD)) {
      if (!slashProse(prose, match.index, match.index + match[0].length, match[0])) continue;
      found.push({ key, word: match[0], korean: KO_GLOSSARY.get(match[1].toLowerCase()) });
    }
  }
  return found;
}

/** Issue references in user strings: `{lang, key, ref}`. */
export function issueReferences(locales) {
  const found = [];
  for (const [lang, tree] of Object.entries(locales)) {
    for (const [key, value] of flatten(tree)) {
      const prose = value.replace(NOT_PROSE, " ");
      for (const match of prose.matchAll(ISSUE_REF)) found.push({ lang, key, ref: match[0] });
    }
  }
  return found;
}

function main() {
  const at = process.argv.indexOf("--locales");
  const root =
    at >= 0 && process.argv[at + 1]
      ? process.argv[at + 1]
      : join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "i18n", "locales");
  const read = (lang) => JSON.parse(readFileSync(join(root, `${lang}.json`), "utf8"));
  const ko = read("ko");
  const en = read("en");
  const github = process.argv.includes("--github");

  const mixed = mixedTerms(ko);
  for (const { key, word, korean } of mixed) {
    const line = `${key}: "${word}" — the ko screen says "${korean}"`;
    console.log(github ? `::warning title=English word in a Korean string (#843)::${line}` : `warning ${line}`);
  }
  const refs = issueReferences({ ko, en });
  for (const { lang, key, ref } of refs) {
    const line = `${lang} ${key}: issue reference ${ref} in a user string`;
    console.log(github ? `::error title=Issue number in a user string (#843)::${line}` : `error ${line}`);
  }
  console.log(
    `Korean strings with a glossary word in English: ${mixed.length} (warning). ` +
      `Issue references in user strings: ${refs.length} (baseline 0).`,
  );
  if (refs.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
