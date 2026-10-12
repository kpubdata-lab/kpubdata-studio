/**
 * Where Studio still decides for itself between a Builder and the demo (#902).
 *
 * The design (`ARCHITECTURE.md`, "하나의 클라이언트 인터페이스", #794) gives each feature
 * one client interface, a real and a demo implementation, and one function that picks
 * between them. A screen that asks `isRealBuilderEnabled()` itself keeps the old
 * `if (real) … else …` split, where nothing says the two answer alike. This counts those
 * calls in `src/` (tests excluded) and holds the count to a shrink-only baseline.
 *
 * Read with the TypeScript parser, so a mention in a comment is not a call. Every use of
 * the name counts — a call, or the function passed or stored — except its own
 * declaration, an import, and a member of the same name (`turn.isDemo`).
 *
 * - `SELECTORS` lists the files where choosing is the job: a feature's client selector,
 *   or a store that is the feature's one entry point. Each holds exactly one use.
 * - `BASELINE` lists every other file with its count today. A file not listed, or a count
 *   above its entry, fails. So does a count below it: lower the entry in the same change,
 *   so the debt cannot grow back into the room it left.
 * - `isDemo()` (`src/shared/lib/demoMode.ts`) is the one place a screen asks whether a
 *   Builder is attached, for what changes only because none is (#902). `DEMO_QUERIES`
 *   lists the files that ask it, with their count: a file not listed, or a count above its
 *   entry, fails, so a screen that reads data cannot use it in place of its feature's
 *   client unnoticed. A count below its entry fails too, to keep the list exact.
 *
 * Usage:
 *   node scripts/real-builder-switch.mjs           # report; exit 1 on a finding
 *   node scripts/real-builder-switch.mjs --github  # the same, with ::error:: annotations
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const NAME = "isRealBuilderEnabled";
const DEMO_QUERY = "isDemo";

/** Files whose one use is the feature choosing its implementation. */
export const SELECTORS = {
  "src/features/add-data/client.ts": "addDataClient()",
  "src/features/artifacts/api/client.ts": "artifactsClient()",
  "src/features/datasets/api/client.ts": "datasetsClient()",
  "src/features/discover/client.ts": "discoverClient()",
  "src/features/preview/api/client.ts": "previewClient()",
  "src/features/publish/api/client.ts": "publishClient()",
  "src/features/sql/warehouseApi.ts": "warehouseApi()",
  "src/features/build-spec/specRevisions.ts": "revisionApi()",
  "src/features/sql/api.ts": "sqlClient()",
  "src/features/validation/api/index.ts": "validationClient()",
  "src/features/monitoring/api/client.ts": "monitoringClient()",
  "src/features/provider/client.ts": "providerClient()",
  "src/features/assistant/query.ts": "assistantClient()",
  "src/features/reports/evidence.ts": "outputEvidence()",
  "src/features/runs/api/client.ts": "runsClient()",
  "src/features/admin/store.ts": "ensureAdminChecked() — the demo has no admin to ask",
  "src/shared/lib/demoMode.ts": "isDemo() — whether a Builder is attached, for screens that change only on that",
  "src/features/version-check/store.ts": "ensureVersionChecked() — the demo has no version to read",
};

/** Direct uses that remain, per file. Shrink-only: lower an entry when its count drops. */
export const BASELINE = {};

/** Files that ask `isDemo()`, and how often: what they change only because no Builder is attached. */
export const DEMO_QUERIES = {
  "src/app/Layout.tsx": 1, // the demo banner and the sign-in menu
  "src/features/add-data/components/ConfigureStep.tsx": 1, // the demo keeps no uploads to list
  "src/features/add-data/useUploadStatus.ts": 1, // nor their expiry
  "src/features/auth/LoginGate.tsx": 1, // the demo needs no sign-in
  "src/features/publish/DataCardPreview.tsx": 1, // the demo has no data cards
  "src/features/version-check/VersionMismatchBanner.tsx": 1, // nor a version to compare
  "src/pages/AdminPage.tsx": 1, // nor an administrator
  "src/pages/LoginPage.tsx": 1, // the demo's sign-in form
  "src/pages/SettingsPage.tsx": 1, // the account section
};

/** Whether `node` names a member (`turn.isDemo`, `{ isDemo: true }`) rather than the function. */
function isMemberName(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

/**
 * How many times `source` uses the name, other than in an import, its declaration or a
 * member of the same name.
 *
 * @param file - the file's path, which picks the parser's TS or TSX mode.
 * @param source - its text.
 * @param name - the function counted; `isRealBuilderEnabled` unless given.
 */
export function countUses(file, source, name = NAME) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  let count = 0;
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      if (node.body) ts.forEachChild(node.body, visit);
      return;
    }
    if (ts.isIdentifier(node) && node.text === name && !isMemberName(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

/** The source files under `src/` that are not tests, as git lists them. */
function sourceFiles(repo) {
  return execFileSync("git", ["ls-files", "src"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith(".d.ts"));
}

/**
 * Compare the counts with the selectors and the baseline.
 *
 * @param counts - `{ file: uses }` for files with at least one use.
 * @returns one message per finding; empty when the tree matches.
 */
export function findings(counts, selectors = SELECTORS, baseline = BASELINE) {
  const out = [];
  for (const [file, count] of Object.entries(counts)) {
    if (file in selectors) {
      if (count !== 1) out.push(`${file}: ${count} uses — a selector holds exactly one (${selectors[file]})`);
    } else if (!(file in baseline)) {
      out.push(`${file}: ${count} new use(s) — ask the feature's client, not isRealBuilderEnabled() (#902)`);
    } else if (count > baseline[file]) {
      out.push(`${file}: ${count} uses, baseline ${baseline[file]} — ask the feature's client (#902)`);
    }
  }
  for (const [file, expected] of Object.entries(baseline)) {
    const count = counts[file] ?? 0;
    if (count < expected) out.push(`${file}: ${count} uses, baseline ${expected} — lower the baseline to ${count}`);
  }
  for (const file of Object.keys(selectors)) {
    if (!counts[file]) out.push(`${file}: listed as a selector but has no use — remove it from SELECTORS`);
  }
  return out;
}

/**
 * Compare the files that ask `isDemo()` with `DEMO_QUERIES`.
 *
 * @param counts - `{ file: uses }` of `isDemo` for files with at least one use.
 * @returns one message per finding; empty when the tree matches.
 */
export function demoQueryFindings(counts, allowed = DEMO_QUERIES) {
  const out = [];
  for (const [file, count] of Object.entries(counts)) {
    if (!(file in allowed)) {
      out.push(`${file}: ${count} new isDemo() use(s) — read data through the feature's client; isDemo() is for what changes only without a Builder (#902)`);
    } else if (count > allowed[file]) {
      out.push(`${file}: ${count} isDemo() uses, listed ${allowed[file]} — read data through the feature's client (#902)`);
    }
  }
  for (const [file, expected] of Object.entries(allowed)) {
    const count = counts[file] ?? 0;
    if (count < expected) out.push(`${file}: ${count} isDemo() uses, listed ${expected} — lower DEMO_QUERIES to ${count}`);
  }
  return out;
}

/** `{ file: uses }` of `name` for the repository at `repo`. */
export function scan(repo, name = NAME) {
  const counts = {};
  for (const file of sourceFiles(repo)) {
    const source = readFileSync(join(repo, file), "utf8");
    if (!source.includes(name)) continue;
    const count = countUses(file, source, name);
    if (count > 0) counts[file] = count;
  }
  return counts;
}

function main() {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const github = process.argv.includes("--github");
  const counts = scan(repo);
  const demoCounts = scan(repo, DEMO_QUERY);
  const found = [...findings(counts), ...demoQueryFindings(demoCounts)];
  for (const line of found) {
    console.log(github ? `::error title=Direct real/demo switch (#902)::${line}` : `error ${line}`);
  }
  const direct = Object.entries(counts).filter(([file]) => !(file in SELECTORS));
  const uses = direct.reduce((sum, [, count]) => sum + count, 0);
  const baseline = Object.values(BASELINE).reduce((sum, count) => sum + count, 0);
  console.log(
    `Direct isRealBuilderEnabled() uses: ${uses} in ${direct.length} files (baseline ${baseline} in ` +
      `${Object.keys(BASELINE).length}). Selectors: ${Object.keys(SELECTORS).length}.`,
  );
  const demoUses = Object.values(demoCounts).reduce((sum, count) => sum + count, 0);
  console.log(`isDemo() uses: ${demoUses} in ${Object.keys(demoCounts).length} files (listed in DEMO_QUERIES).`);
  if (found.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
