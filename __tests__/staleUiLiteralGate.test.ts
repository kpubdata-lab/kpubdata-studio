/**
 * The stale-UI-literal gate has to actually fail (studio#429).
 *
 * The fixture strings are synthetic on purpose. Using a real removed product string
 * made the gate flag this very file — a false positive it created for itself.
 *
 * Two earlier versions of this gate passed everything, and both were only found by
 * deliberately breaking something and watching the gate stay green. So the gate gets
 * a test that breaks something on purpose.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-stale-ui-literals.mjs",
);

let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Run the gate in the fixture repository and return its exit code and output. */
function runGate(base: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, "--base", base], {
      cwd: repo,
      env: { ...process.env, STALE_UI_REPO_ROOT: repo },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function writeLocales(value: string): void {
  const dir = join(repo, "src/shared/i18n/locales");
  mkdirSync(dir, { recursive: true });
  for (const locale of ["en", "ko"]) {
    writeFileSync(
      join(dir, `${locale}.json`),
      `${JSON.stringify({ nav: { assistant: value } }, null, 2)}\n`,
    );
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "stale-ui-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  mkdirSync(join(repo, "__tests__"), { recursive: true });
  writeLocales("합성된예전문구입니다테스트전용");
  writeFileSync(
    join(repo, "__tests__/home.test.tsx"),
    'const HERO = "합성된예전문구입니다테스트전용";\n',
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("stale UI literal gate", () => {
  it("fails when a removed string is still asserted", () => {
    // The change that caused #429: the locale value moves, the test does not.
    writeLocales("합성된새문구입니다테스트전용");
    git(["add", "-A"]);
    git(["commit", "-qm", "rename"]);

    const { code, out } = runGate("HEAD~1");

    expect(code).toBe(1);
    expect(out).toContain("__tests__/home.test.tsx");
    expect(out).toContain("합성된예전문구");
  });

  it("passes when the test moved with the string", () => {
    writeLocales("합성된새문구입니다테스트전용");
    writeFileSync(
      join(repo, "__tests__/home.test.tsx"),
      'const HERO = "합성된새문구입니다테스트전용";\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "rename with tests"]);

    expect(runGate("HEAD~1").code).toBe(0);
  });

  it("passes when no string was removed", () => {
    // Adding a key must not trip the gate.
    const dir = join(repo, "src/shared/i18n/locales");
    for (const locale of ["en", "ko"]) {
      writeFileSync(
        join(dir, `${locale}.json`),
        `${JSON.stringify(
          {
            nav: { assistant: "합성된예전문구입니다테스트전용" },
            extra: { added: "새로 추가한 문장입니다" },
          },
          null,
          2,
        )}\n`,
      );
    }
    git(["add", "-A"]);
    git(["commit", "-qm", "add a key"]);

    const { code, out } = runGate("HEAD~1");
    expect(code).toBe(0);
    expect(out).toContain("제거되지 않았다");
  });

  it("ignores a short removed string", () => {
    // "저장" and the like appear in unrelated tests, and a false failure is how a
    // gate gets switched off.
    writeLocales("저장");
    git(["add", "-A"]);
    git(["commit", "-qm", "short"]);
    writeLocales("보관");
    writeFileSync(join(repo, "__tests__/home.test.tsx"), 'const A = "저장";\n');
    git(["add", "-A"]);
    git(["commit", "-qm", "shorter"]);

    expect(runGate("HEAD~1").code).toBe(0);
  });

  it("skips rather than fails when the base ref is missing", () => {
    const { code, out } = runGate("origin/does-not-exist");
    expect(code).toBe(0);
    expect(out).toContain("건너뛴다");
  });
});
