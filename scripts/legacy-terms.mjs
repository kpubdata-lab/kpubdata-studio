/**
 * Names of the old build-console screens in user strings (#423).
 *
 * Studio's navigation was a build console: Discover, Add Data, Datasets, Builds,
 * Provider, Kubi. It is now Catalog, Tables and SQL, and the maintainer's decision of
 * 2026-10-06 (kpubdata#812, recorded on #423) is that the old names are removed, not
 * kept beside the new ones. This reads every value of `ko.json` and `en.json` and fails
 * on a retired name. The baseline is zero.
 *
 * What is read and what is not follows `ko-mixed-terms.mjs`: `{{placeholders}}`,
 * `` `code` ``, `<tags>` and URLs are not prose, and a word joined to `_`, `.`, `/`, `[`
 * or `-`, or followed by `=`, is part of a code or a path (`CREATE_BUILD_DRAFT`,
 * `/refresh-jobs?run=`). Locale keys, code identifiers and Builder's field names are out
 * of scope by the same decision: the gate reads values only.
 *
 * Two of the old names are also words the product still uses, so they are retired only
 * where the decision retires them:
 *
 *   - "Dataset" alone was the old name of a table. "Source dataset" is the current name
 *     of a provider's public API dataset (kpubdata TERMINOLOGY.md), so only an
 *     unqualified "dataset" is reported.
 *   - "Provider" was the old name of the Connections screen. A provider is still the
 *     institution that serves the data, so the word is reported only in the keys that
 *     name a screen (`SCREEN_NAME_KEYS`) and in a phrase that points at a screen
 *     ("the provider screen", "Provider / API connections", "제공자 설정").
 *
 * `ALLOWED` lists the places where a retired name stays, each with its reason. An entry
 * is one key in one language, so a new use of the same name elsewhere still fails, and
 * an entry whose value no longer holds the name fails too — the list cannot outlive
 * what it excuses.
 *
 * Usage:
 *   node scripts/legacy-terms.mjs               # report; exit 1 on a retired name
 *   node scripts/legacy-terms.mjs --github      # the same, with ::error:: annotations
 *   node scripts/legacy-terms.mjs --locales D   # read ko.json and en.json from D (tests)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { flatten } from "./ko-mixed-terms.mjs";

const NOT_PROSE = /\{\{[^}]*\}\}|`[^`]*`|<[^>]+>|https?:\/\/\S+/g;

/**
 * An English word that is not part of a code or a path. A full stop after the word joins
 * it to a path only when a letter follows (`build.id`): "Go to Add Data." ends a sentence.
 */
const word = (body, flags = "gi") =>
  new RegExp(String.raw`(?<![A-Za-z_./\[-])(?:${body})(?![A-Za-z_\[=-]|\.[A-Za-z_])`, flags);

/** Keys whose value is the name of a screen: the menu, its tooltips and page titles. */
export const SCREEN_NAME_KEYS = /^(nav|navDescription|router\.features|assistant\.context\.page)\./;

/**
 * The retired names. `now` is what the screen says instead; `keys`, when present, limits
 * the rule to the keys it matches.
 */
export const LEGACY_TERMS = [
  // Case-sensitive: "data discovery" and "discover" as plain verbs are not the screen.
  { term: "Discover", pattern: word("Discover", "g"), now: "Catalog / 카탈로그" },
  { term: "Add Data", pattern: word("Add Data"), now: "Create Table / 테이블 만들기" },
  { term: "데이터 추가", pattern: /데이터 추가/g, now: "테이블 만들기" },
  { term: "Datasets", pattern: word(String.raw`(?<!source )datasets?`), now: "Tables, or \"source dataset\" for a provider's dataset" },
  { term: "데이터셋", pattern: /(?<!소스 )데이터셋/g, now: "테이블, or \"소스 데이터셋\" for a provider's dataset" },
  // "New Build", the old global button, is caught by this rule too.
  { term: "build", pattern: word("(?:re)?buil(?:ds?|ding|t)"), now: "create, run or refresh — BuildSpec stays, it is a format name" },
  { term: "빌드", pattern: /빌드/g, now: "만들기, 실행 or 갱신 — BuildSpec stays" },
  { term: "Kubi", pattern: new RegExp(`${word("kubi").source}|쿠비`, "gi"), now: "Ask KPubData" },
  { term: "작업대", pattern: /작업대/g, now: "undecided — see ALLOWED" },
  { term: "갱신 이력", pattern: /갱신 이력/g, now: "undecided — see ALLOWED" },
  { term: "Provider (screen)", pattern: word("providers?"), keys: SCREEN_NAME_KEYS, now: "Connections / 연결" },
  {
    term: "Provider (screen)",
    pattern: /providers? (?:screen|page|settings)|provider \/ API|제공자 \/ API|제공자 (?:설정|페이지|화면)/gi,
    now: "Connections / 연결",
  },
];

const WORKSPACE_REASON =
  "docs/ko-glossary.md (#892, 2026-10-11) names the Workspace screen \"작업대\", five days after the " +
  "decision retired the word; the glossary is the newer text and is kept until the maintainer settles it";
const HISTORY_REASON =
  "the decision retires \"갱신 이력\" without naming what replaces it, and the label is in the sidebar " +
  "of every desktop visual baseline; renaming it is the maintainer's choice and needs new baselines";

/** Where a retired name stays: one key in one language, with the reason. */
export const ALLOWED = [
  ...[
    "nav.workspace",
    "newBuild.review.saveSpec",
    "newBuild.review.savedAs",
    "assistant.context.page.workspace",
    "workspace.title",
    "router.features.Workspace",
  ].map((key) => ({ lang: "ko", key, term: "작업대", reason: WORKSPACE_REASON })),
  ...[
    "nav.builds",
    "builds.page.title",
    "builds.detail.continuesWithoutPage",
    "builds.detail.back",
    "builds.table.caption",
    "assistant.context.page.builds",
  ].map((key) => ({ lang: "ko", key, term: "갱신 이력", reason: HISTORY_REASON })),
  ...["en", "ko"].map((lang) => ({
    lang,
    key: "buildPublish.privateLabel",
    term: "Datasets",
    reason: "names a Hugging Face dataset repository, which is Hugging Face's own word for it",
  })),
  {
    lang: "en",
    key: "navDescription.discover",
    term: "Provider (screen)",
    reason: "says how the catalog is grouped — by the institution that serves the data — and names no screen",
  },
];

const allowedId = ({ lang, key, term }) => `${lang}\u0000${key}\u0000${term}`;

/**
 * Retired names in user strings.
 *
 * @param locales - `{ ko, en }` locale trees.
 * @param allowed - the exceptions; `ALLOWED` unless a test passes its own.
 * @returns `found`: `{lang, key, term, text, now}` for each retired name outside the
 *   exceptions; `unused`: exceptions whose value no longer holds the name.
 */
export function legacyTerms(locales, allowed = ALLOWED) {
  const excused = new Set(allowed.map(allowedId));
  const used = new Set();
  const found = [];
  for (const [lang, tree] of Object.entries(locales)) {
    for (const [key, value] of flatten(tree)) {
      const prose = value.replace(NOT_PROSE, " ");
      for (const { term, pattern, keys, now } of LEGACY_TERMS) {
        if (keys && !keys.test(key)) continue;
        for (const match of prose.matchAll(pattern)) {
          const id = allowedId({ lang, key, term });
          if (excused.has(id)) used.add(id);
          else found.push({ lang, key, term, text: match[0], now });
        }
      }
    }
  }
  return { found, unused: allowed.filter((entry) => !used.has(allowedId(entry))) };
}

function main() {
  const at = process.argv.indexOf("--locales");
  const root =
    at >= 0 && process.argv[at + 1]
      ? process.argv[at + 1]
      : join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "i18n", "locales");
  const read = (lang) => JSON.parse(readFileSync(join(root, `${lang}.json`), "utf8"));
  const github = process.argv.includes("--github");

  const { found, unused } = legacyTerms({ ko: read("ko"), en: read("en") });
  for (const { lang, key, term, text, now } of found) {
    const line = `${lang} ${key}: "${text}" is the retired name "${term}" — the screen now says ${now}`;
    console.log(github ? `::error title=Retired screen name in a user string (#423)::${line}` : `error ${line}`);
  }
  for (const { lang, key, term } of unused) {
    const line = `${lang} ${key}: the exception for "${term}" excuses nothing — remove it from ALLOWED`;
    console.log(github ? `::error title=Unused legacy-term exception (#423)::${line}` : `error ${line}`);
  }
  console.log(
    `Retired screen names in user strings: ${found.length} (baseline 0). ` +
      `Exceptions: ${ALLOWED.length}, unused: ${unused.length} (baseline 0).`,
  );
  if (found.length > 0 || unused.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
