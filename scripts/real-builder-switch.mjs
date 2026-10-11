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
 * declaration in `builderApi.ts` and an import.
 *
 * - `SELECTORS` lists the files where choosing is the job: a feature's client selector,
 *   or a store that is the feature's one entry point. Each holds exactly one use.
 * - `BASELINE` lists every other file with its count today. A file not listed, or a count
 *   above its entry, fails. So does a count below it: lower the entry in the same change,
 *   so the debt cannot grow back into the room it left.
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
  "src/features/admin/store.ts": "ensureAdminChecked() — the demo has no admin to ask",
  "src/features/version-check/store.ts": "ensureVersionChecked() — the demo has no version to read",
};

/** Direct uses that remain, per file. Shrink-only: lower an entry when its count drops. */
export const BASELINE = {
  "src/app/Layout.tsx": 1,
  "src/features/add-data/components/ConfigureStep.tsx": 1,
  "src/features/add-data/useUploadStatus.ts": 1,
  "src/features/assistant/demo.ts": 1,
  "src/features/assistant/generate.ts": 1,
  "src/features/assistant/query.ts": 1,
  "src/features/auth/LoginGate.tsx": 1,
  "src/features/provider/KeyProbePanel.tsx": 1,
  "src/features/publish/DataCardPreview.tsx": 1,
  "src/features/reports/evidence.ts": 1,
  "src/features/runs/api/getBuild.ts": 1,
  "src/features/runs/api/index.ts": 2,
  "src/features/runs/api/runDetail.ts": 2,
  "src/features/version-check/VersionMismatchBanner.tsx": 1,
  "src/pages/AdminPage.tsx": 1,
  "src/pages/BuildRunPage.tsx": 1,
  "src/pages/BuildsPage.tsx": 4,
  "src/pages/LoginPage.tsx": 1,
  "src/pages/ProviderPage.tsx": 5,
  "src/pages/SettingsPage.tsx": 1,
};

/**
 * How many times `source` uses the name, other than in an import or its declaration.
 *
 * @param file - the file's path, which picks the parser's TS or TSX mode.
 * @param source - its text.
 */
export function countUses(file, source) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  let count = 0;
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === NAME) {
      if (node.body) ts.forEachChild(node.body, visit);
      return;
    }
    if (ts.isIdentifier(node) && node.text === NAME) count += 1;
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

/** `{ file: uses }` for the repository at `repo`. */
export function scan(repo) {
  const counts = {};
  for (const file of sourceFiles(repo)) {
    const source = readFileSync(join(repo, file), "utf8");
    if (!source.includes(NAME)) continue;
    const count = countUses(file, source);
    if (count > 0) counts[file] = count;
  }
  return counts;
}

function main() {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const github = process.argv.includes("--github");
  const counts = scan(repo);
  const found = findings(counts);
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
  if (found.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
