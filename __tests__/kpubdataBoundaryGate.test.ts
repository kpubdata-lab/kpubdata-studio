/**
 * The kpubdata boundary gate has to actually fail (studio#511).
 *
 * Studio consumes only Builder's HTTP/OpenAPI contract. The gate runs against a
 * fixture repository with one file under `src/`, so each case proves the gate fails
 * on the reference it is meant to catch and passes on what Studio may say.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "check-kpubdata-boundary.mjs");

let repo: string;

function git(args: string[]): void {
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

/** Commit `text` as the only file under `src/` and run the gate on it. */
function runGate(text: string): { code: number; out: string } {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "sample.ts"), `${text}\n`);
  git(["add", "-A"]);
  try {
    const out = execFileSync("node", [SCRIPT], {
      cwd: repo,
      env: { ...process.env, KPUBDATA_BOUNDARY_ROOT: repo },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kpubdata-boundary-"));
  git(["init", "-q"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("kpubdata boundary gate (#511)", () => {
  it.each([
    ["a private constant", "// `access` uses kpubdata's probe identifiers (`PROBE_STATUSES`) as they are.", "private kpubdata constant"],
    ["an attributed upper-snake name", "// mirrors kpubdata's `DEFAULT_PAGE_SIZE`", "private kpubdata constant"],
    ["a kpubdata source path", "// see kpubdata/src/kpubdata/probe.py", "kpubdata source path"],
    ["a Builder package path", "// defined in src/kpubdata_builder/service/app.py", "kpubdata source path"],
    ["a Python module", "// shape of kpubdata.providers.datago", "Python module or file"],
    ["a Python file", "/** Builder schema_summary.py FieldSummary */", "Python module or file"],
    ["a test fixture", "// must match kpubdata's replay fixture exactly", "kpubdata test fixture"],
  ])("fails on %s", (_label, line, rule) => {
    const { code, out } = runGate(line);
    expect(code).toBe(1);
    expect(out).toContain(`src/sample.ts:1: ${rule}`);
  });

  it("passes on the contract, issue references and Studio's own names", () => {
    const { code, out } = runGate(
      [
        "// `SourceRef` in Builder's OpenAPI contract (kpubdata-builder#693, kpubdata#504)",
        "// BUILDER_CONTRACT=../kpubdata-builder/contract/builder-api.yaml",
        'const KEY = "kpubdata-studio:reports";',
        'const PREFIX = "kpubdata:onboarding:v2";',
        'vi.stubEnv("VITE_OIDC_ISSUER", "http://localhost:8080/realms/kpubdata");',
      ].join("\n"),
    );
    expect(out).toContain("kpubdata boundary OK");
    expect(code).toBe(0);
  });
});
