/**
 * English UI text written directly in TSX (#531).
 *
 * The Korean extraction gate (`i18n-coverage.mjs`) counts Korean literals, and the
 * terminology gates read the locale files, so an English label typed straight into a
 * screen — `<h3>Data Passport</h3>`, `label="Assistant"` — passed every check and never
 * reached the locale, the Korean screen or the terminology review. This module finds it.
 *
 * What counts as UI text: JSX text, a string literal passed as a JSX child
 * (`{"Run"}`), and a string literal on a prop a person reads (`label`, `title`,
 * `placeholder`, `aria-label`, `alt` …). Parsed with the TypeScript scanner, so
 * comments, class names and code are never candidates.
 *
 * A `.ts` module has no JSX but still reaches a screen (#572): a `label` kept in data a
 * component renders, the `message` of a zod issue, the error string of a zod check
 * (`.min(1, "…")`). Those shapes are read there too; mock and demo modules are skipped.
 *
 * What is not: text inside `<code>`, `<kbd>`, `<pre>`, `<samp>` or `<style>`; a line
 * marked `i18n-ignore: <reason>` (or the line above it); and text made only of words
 * that are not translated — brand names, file formats, status codes Builder sends
 * (PASS/WARN/FAIL), the Bronze/Silver/Gold stage names — and of identifiers, paths,
 * URLs, numbers and punctuation. Everything else belongs in `src/shared/i18n/locales`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

/** JSX props whose string value a person reads or hears. */
export const SHOWN_PROPS = new Set([
  "label",
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "alt",
  "description",
  "eyebrow",
  "sub",
  "actionLabel",
  "heading",
]);

/**
 * In a `.ts` module, where there is no JSX, the extra property that reaches a screen:
 * the `message` of a zod issue (`ctx.addIssue({ message })`), shown as a form error.
 */
const TS_SHOWN_PROPS = new Set(["message"]);

/** zod checks whose second argument is the error a person reads (`.min(1, "…")`). */
const ZOD_CHECKS = new Set(["min", "max", "length", "regex", "refine", "email", "url", "startsWith", "endsWith", "includes", "nonempty"]);

/** Elements whose text is code, not prose. */
const CODE_ELEMENTS = new Set(["code", "kbd", "pre", "samp", "style"]);

/** Phrases that stay as they are in every language (brand, formats). Removed first. */
const KEPT_PHRASES = [/https?:\/\/\S+/g, /&[a-z]+;/g, /KPubData(?: (?:Builder|Studio))?/g, /Hugging Face/g, /JSON Lines/g, /SQL Workspace/g, /Ask KPubData/g];

/** Single words that are not translated: formats, acronyms, Builder's codes, stage names. */
const KEPT_WORDS = new Set([
  "PASS",
  "WARN",
  "FAIL",
  "DEMO",
  "Bronze",
  "Silver",
  "Gold",
  "CSV",
  "JSON",
  "JSONL",
  "YAML",
  "SQL",
  "API",
  "ID",
  "URL",
  "ms",
  "rev",
  // Builder's quality availability and publish target, shown as sent.
  "UNAVAILABLE",
  "huggingface",
]);

/** A token that is an identifier, path, URL, placeholder value or number, not a word. */
const CODE_LIKE = /[_./=@\\]|^[a-z0-9]+(?:-[a-z0-9]+)+$|^\d/;

/** Whether `text` has English a person would read as a sentence or label. */
export function isEnglishProse(text) {
  let rest = text;
  for (const phrase of KEPT_PHRASES) rest = rest.replace(phrase, " ");
  const words = rest.split(/[\s·:,;()[\]{}→←—–|+&%*'"!?…↗<>#]+/).filter(Boolean);
  return words.some((word) => /[A-Za-z]{2,}/.test(word) && !KEPT_WORDS.has(word) && !CODE_LIKE.test(word));
}

const IGNORE_MARKER = /i18n-ignore/;

/** A line that holds only a comment: a line comment, a block comment or its continuation, or a JSX comment. */
const COMMENT_LINE = /^(?:\/\/|\/\*|\*|\{\s*\/\*)/;

/**
 * Whether the text on `line` is exempt: the marker is on that line, or on the nearest
 * non-blank line above it when that line is a comment. A marker on a code line exempts
 * only that line, not the one after it.
 */
function ignored(lines, line) {
  if (IGNORE_MARKER.test(lines[line - 1] ?? "")) return true;
  for (let index = line - 2; index >= 0; index--) {
    const above = (lines[index] ?? "").trim();
    if (above === "") continue;
    return COMMENT_LINE.test(above) && IGNORE_MARKER.test(above);
  }
  return false;
}

function insideCode(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) {
      const tag = parent.openingElement.tagName.getText();
      if (CODE_ELEMENTS.has(tag)) return true;
    }
  }
  return false;
}

/**
 * Every piece of UI text in `source`, as `{ line, text }`, before the English filter.
 * The terminology gate reads these too, with no exemption.
 */
export function uiTexts(file, source) {
  const plainTs = !file.endsWith(".tsx");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, plainTs ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const propName = (node) => node.name.getText(sourceFile).replace(/^["']|["']$/g, "");
  const found = [];
  const add = (node, text) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed || insideCode(node)) return;
    found.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, text: trimmed });
  };
  // The strings an expression can render as it is: `"Done"`, `ok ? "Done" : "Ready"`,
  // `label ?? "Run"` — not strings passed to a function, which are keys or code.
  const leaves = (expression) => {
    if (!expression) return;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) add(expression, expression.text);
    // `Run ${id}` — the literal parts, with each substitution read as a space.
    else if (ts.isTemplateExpression(expression)) {
      add(expression, [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(" "));
    }
    else if (ts.isParenthesizedExpression(expression)) leaves(expression.expression);
    else if (ts.isConditionalExpression(expression)) {
      leaves(expression.whenTrue);
      leaves(expression.whenFalse);
    } else if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(expression.operatorToken.kind)) {
      leaves(expression.right);
    }
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxAttribute(node) && node.initializer && SHOWN_PROPS.has(node.name.getText(sourceFile))) {
      if (ts.isStringLiteral(node.initializer)) add(node, node.initializer.text);
      else if (ts.isJsxExpression(node.initializer)) leaves(node.initializer.expression);
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      leaves(node.expression);
    } else if (
      // `{ id: "overview", label: "Overview" }` — a label kept in a constant and rendered later.
      ts.isPropertyAssignment(node) &&
      (SHOWN_PROPS.has(propName(node)) || (plainTs && TS_SHOWN_PROPS.has(propName(node))))
    ) {
      leaves(node.initializer);
    } else if (
      // `z.string().min(1, "Alias cannot be empty.")` — a zod check's message.
      plainTs &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ZOD_CHECKS.has(node.expression.name.text) &&
      node.arguments.length > 1
    ) {
      leaves(node.arguments[1]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** English UI text in one `.tsx` or `.ts` source that should be in the locale files. */
export function hardCodedEnglish(file, source) {
  const lines = source.split("\n");
  return uiTexts(file, source).filter(({ line, text }) => isEnglishProse(text) && !ignored(lines, line));
}

/**
 * Mock and demo modules (`mockData.ts`, `demoDatasets.ts`, `demo.ts`): sample records
 * standing in for what Builder or a user would send, not text Studio writes itself.
 */
const FIXTURE = /^(mock|demo)\w*\.ts$/;

/**
 * Every non-test `.tsx` and `.ts` source under `dir`, as paths relative to it. A `.ts`
 * module has no JSX, but a label or a zod message written there still reaches a screen
 * (#572), so it is read for the property and zod shapes `uiTexts` knows.
 */
function sourceFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full, base);
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !FIXTURE.test(name)
      ? [relative(base, full)]
      : [];
  });
}

/** `file:line: text` for every English UI string hard-coded under `srcRoot`. */
export function scanEnglish(srcRoot) {
  return sourceFiles(srcRoot).flatMap((file) =>
    hardCodedEnglish(file, readFileSync(join(srcRoot, file), "utf8")).map((hit) => `${file}:${hit.line}: ${hit.text}`),
  );
}

/** `{ file, line, text }` for every piece of UI text under `srcRoot`, unfiltered. */
export function scanUiTexts(srcRoot) {
  return sourceFiles(srcRoot).flatMap((file) =>
    uiTexts(file, readFileSync(join(srcRoot, file), "utf8")).map((hit) => ({ file, ...hit })),
  );
}
