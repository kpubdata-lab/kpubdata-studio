/**
 * Every `t("…")` key must exist in both locale files (studio#448).
 *
 * This gate exists because studio#360 shipped `t("layout.homeLink")` against a locale
 * file that spells it `layout.studioHome`. Nothing failed at build or lint time: i18next
 * renders a missing key as the key itself, so the sidebar's home link carried the
 * aria-label `layout.homeLink`. One test happened to assert on that label and caught it.
 * Nothing would have caught the other 1,400.
 *
 * Four things are checked. The first three are a missing key; the fourth is a key that
 * exists but was never translated:
 *
 *   1. A literal key — `t("a.b")` or `<Trans i18nKey="a.b">` — resolves in ko and in en.
 *   2. A computed key — `t(`a.b.${x}`)` — has its static prefix (`a.b`) present as a
 *      subtree. The leaf cannot be checked statically, but renaming or dropping the
 *      whole group can, and that is the failure that actually happens.
 *   3. ko and en hold the same set of keys. A key present in only one language is
 *      half-translated, and which half is missing decides who sees the raw key.
 *   4. No ko value is the en value left in English (studio#588) — see
 *      `ko-english-values.mjs`. The baseline is zero: every such value found when the
 *      check was added was translated, so any new one fails.
 *
 * Keys are read with the TypeScript parser rather than a regular expression, because
 * `t(` also matches `format(`, `at(` and `split(` — a grep-based first draft reported
 * 400 keys that were not keys.
 *
 * Several modules declare their own `t`:
 *
 *     const t = (key) => i18n.t(`reports.export.${key}`);
 *
 * Its argument is a suffix, not a key. A first version of this gate did not know that
 * and reported 190 keys that resolve perfectly well — enough noise to bury the one real
 * finding. So the wrapper's prefix is read off its body and put back on. A file that
 * declares `t` in a shape this cannot read is reported rather than skipped: a gate that
 * quietly drops files is the failure mode this repository has already hit twice.
 *
 * Usage:
 *   node scripts/check-i18n-keys.mjs           # exit 1 on any finding
 *   node scripts/check-i18n-keys.mjs --root D  # run against a fixture tree (tests)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

import { englishKoValues } from "./ko-english-values.mjs";

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);
const SKIP_SUFFIX = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".d.ts"];

const rootFlag = process.argv.indexOf("--root");
const ROOT =
  rootFlag === -1
    ? new URL("..", import.meta.url).pathname
    : process.argv[rootFlag + 1];
const SRC = join(ROOT, "src");
const LOCALES = join(SRC, "shared/i18n/locales");

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name) && !SKIP_SUFFIX.some((s) => name.endsWith(s))) {
      files.push(full);
    }
  }
  return files;
}

/** Flattens {a: {b: "x"}} to the key set {"a.b"}, and records "a" as a subtree. */
function flatten(value, prefix, leaves, subtrees) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      subtrees.add(path);
      flatten(child, path, leaves, subtrees);
    } else {
      leaves.add(path);
    }
  }
}

function loadLocale(lang) {
  const leaves = new Set();
  const subtrees = new Set();
  const tree = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8"));
  flatten(tree, "", leaves, subtrees);
  return { tree, leaves, subtrees };
}

/** The part of a template literal before its first `${`, with the trailing dot removed. */
function staticPrefix(node) {
  const head = node.head.text;
  const dot = head.lastIndexOf(".");
  return dot === -1 ? "" : head.slice(0, dot);
}

/**
 * The namespace a file-local `t` wrapper prepends, or null when the file has no wrapper.
 * Returns the string "?" when a wrapper exists but its prefix cannot be read.
 */
function wrapperPrefix(source) {
  let result = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "t" &&
      node.initializer
    ) {
      result = "?";
      let found = null;
      const scan = (n) => {
        if (
          ts.isCallExpression(n) &&
          n.arguments[0] &&
          ts.isTemplateExpression(n.arguments[0])
        ) {
          const prefix = staticPrefix(n.arguments[0]);
          if (prefix) found = prefix;
        }
        ts.forEachChild(n, scan);
      };
      scan(node.initializer);
      if (found) result = found;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

/** Collects every translation key this file asks for. */
function keysIn(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const prefix = wrapperPrefix(source);
  if (prefix === "?") return [{ key: null, kind: "wrapper", line: 1 }];
  const qualify = (key) => (prefix ? `${prefix}.${key}` : key);

  const at = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        found.push({ key: qualify(arg.text), kind: "leaf", line: at(node) });
      } else if (arg && ts.isTemplateExpression(arg)) {
        const p = staticPrefix(arg);
        if (p) found.push({ key: qualify(p), kind: "subtree", line: at(node) });
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "i18nKey") {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) {
        found.push({ key: init.text, kind: "leaf", line: at(node) });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return found;
}

const ko = loadLocale("ko");
const en = loadLocale("en");
const problems = [];

for (const file of walk(SRC)) {
  const shown = relative(ROOT, file);
  for (const { key, kind, line } of keysIn(file)) {
    if (kind === "wrapper") {
      problems.push(`${shown}  declares its own \`t\`, but its namespace could not be read`);
      continue;
    }
    const have = kind === "leaf" ? ko.leaves : ko.subtrees;
    const haveEn = kind === "leaf" ? en.leaves : en.subtrees;
    const missing = [!have.has(key) && "ko", !haveEn.has(key) && "en"].filter(Boolean);
    if (missing.length) {
      const what = kind === "leaf" ? "key" : "key prefix";
      problems.push(`${shown}:${line}  ${what} "${key}" missing from ${missing.join(" and ")}`);
    }
  }
}

const onlyKo = [...ko.leaves].filter((k) => !en.leaves.has(k));
const onlyEn = [...en.leaves].filter((k) => !ko.leaves.has(k));
for (const k of onlyKo) problems.push(`locales  "${k}" is in ko.json but not en.json`);
for (const k of onlyEn) problems.push(`locales  "${k}" is in en.json but not ko.json`);

const untranslated = englishKoValues(ko.tree, en.tree);
for (const [k, value] of untranslated) {
  problems.push(`locales  "${k}" is English in ko.json (${JSON.stringify(value)}) — translate it, or add a product name or format to KEPT_VALUES`);
}

if (problems.length) {
  console.error(`i18n key gate: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nA missing key is not a blank screen — i18next renders the key itself, so the` +
      `\nuser sees "layout.homeLink" where a label should be.`,
  );
  process.exit(1);
}

console.log(
  `i18n key gate: every key resolves, ko/en hold the same key set (${ko.leaves.size} keys), ` +
    `and no ko value is untranslated English (${untranslated.length}, baseline 0).`,
);
