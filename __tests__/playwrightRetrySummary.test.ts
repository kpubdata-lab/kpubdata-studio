/**
 * The Playwright reporter that counts passes on retry apart from first-pass passes (#995).
 *
 * The classification and the summary are checked on attempt lists built here; one test
 * runs Playwright itself on a generated suite holding a deliberately flaky test, so the
 * reporter is checked against the attempts Playwright really records.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  LINE_PREFIX,
  annotations,
  classify,
  renderMarkdown,
  summarize,
  type TestAttempts,
} from "../scripts/playwright-retry-summary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const attempts = (
  title: string,
  statuses: string[],
  project = "desktop-chromium",
  expectedStatus = "passed",
): TestAttempts => ({
  project,
  file: "e2e/sample.spec.ts",
  line: 10,
  title,
  statuses,
  expectedStatus,
});

describe("classify", () => {
  it.each([
    [["passed"], "passed"],
    [["failed", "passed"], "flaky"],
    [["timedOut", "passed"], "flaky"],
    [["failed", "failed"], "failed"],
    [["interrupted"], "failed"],
    [["skipped"], "skipped"],
    [[], "skipped"],
  ])("reads attempts %j as %s", (statuses, outcome) => {
    expect(classify({ statuses, expectedStatus: "passed" })).toBe(outcome);
  });

  it("measures attempts against the expected status, so test.fail() that fails passes first time", () => {
    expect(classify({ statuses: ["failed"], expectedStatus: "failed" })).toBe(
      "passed",
    );
    expect(
      classify({ statuses: ["passed", "failed"], expectedStatus: "failed" }),
    ).toBe("flaky");
  });
});

describe("summarize and renderMarkdown", () => {
  const summary = summarize("E2E (Playwright)", [
    attempts("steady", ["passed"]),
    attempts("recovers", ["failed", "passed"]),
    attempts("broken", ["failed", "failed"]),
    attempts("not here", ["skipped"]),
    attempts("steady on mobile", ["passed"], "mobile-chromium"),
  ]);

  it("counts first-pass passes, passes on retry and hard failures per project", () => {
    expect(summary.projects).toEqual([
      {
        project: "desktop-chromium",
        total: 4,
        passed: 1,
        flaky: 1,
        failed: 1,
        skipped: 1,
        firstPassFailures: 2,
      },
      {
        project: "mobile-chromium",
        total: 1,
        passed: 1,
        flaky: 0,
        failed: 0,
        skipped: 0,
        firstPassFailures: 0,
      },
    ]);
    expect(summary.total).toMatchObject({
      total: 5,
      passed: 2,
      flaky: 1,
      failed: 1,
      skipped: 1,
      firstPassFailures: 2,
    });
    expect(summary.flaky.map((test) => test.title)).toEqual(["recovers"]);
    expect(summary.failed.map((test) => test.title)).toEqual(["broken"]);
  });

  it("names each test that passed only on retry, with its location and attempts", () => {
    const markdown = renderMarkdown(summary);
    expect(markdown).toContain("| desktop-chromium | 4 | 1 | 1 | 1 | 1 | 2 |");
    expect(markdown).toContain("| **total** | 5 | 2 | 1 | 1 | 1 | 2 |");
    expect(markdown).toContain("**1 test(s) passed only on retry.**");
    expect(markdown).toContain(
      "- `e2e/sample.spec.ts:10` recovers (desktop-chromium; attempts: failed → passed)",
    );
    expect(markdown).toContain("**1 test(s) failed on every attempt.**");
  });

  it("says so when nothing needed a retry", () => {
    expect(
      renderMarkdown(summarize("E2E", [attempts("steady", ["passed"])])),
    ).toContain("No test passed only on retry.");
  });

  it("annotates each flaky test as a warning at its location", () => {
    expect(annotations(summary)).toEqual([
      "::warning file=e2e/sample.spec.ts,line=10,title=Passed only on retry::recovers (desktop-chromium) failed its first attempt and passed on retry (failed -> passed)",
    ]);
  });
});

describe("the reporter in a real Playwright run", () => {
  let dir: string;
  beforeEach(() => {
    // Under node_modules so the generated suite resolves @playwright/test from the repository.
    const cache = join(ROOT, "node_modules", ".cache");
    mkdirSync(cache, { recursive: true });
    dir = mkdtempSync(join(cache, "pw-retry-summary-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a deliberately flaky test as passed on retry, not as a first-pass success", () => {
    const reporter = join(ROOT, "scripts", "playwright-retry-summary.mjs");
    writeFileSync(
      join(dir, "playwright.config.mjs"),
      [
        'import { defineConfig } from "@playwright/test";',
        "export default defineConfig({",
        '  testDir: ".",',
        "  retries: 1,",
        "  workers: 1,",
        `  reporter: [[${JSON.stringify(reporter)}, { suite: "Fixture suite" }]],`,
        '  projects: [{ name: "fixture" }],',
        "});",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "fixture.spec.mjs"),
      [
        'import { expect, test } from "@playwright/test";',
        'test("steady", () => { expect(1).toBe(1); });',
        'test("flaky on purpose", ({}, testInfo) => { expect(testInfo.retry).toBe(1); });',
        'test("always broken", () => { expect(1).toBe(2); });',
        "",
      ].join("\n"),
    );
    const stepSummary = join(dir, "step-summary.md");

    const run = spawnSync(
      join(ROOT, "node_modules", ".bin", "playwright"),
      ["test", "-c", "playwright.config.mjs"],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "",
          GITHUB_ACTIONS: "true",
          GITHUB_STEP_SUMMARY: stepSummary,
        },
        timeout: 60_000,
      },
    );

    // The hard failure fails the run; the reporter does not change that, nor fail it for the flaky test.
    expect(run.status, run.stderr).toBe(1);
    const line = run.stdout
      .split("\n")
      .find((text) => text.startsWith(`${LINE_PREFIX} `));
    expect(line, run.stdout).toBeDefined();
    const reported = JSON.parse(line!.slice(LINE_PREFIX.length + 1)) as {
      total: {
        passed: number;
        flaky: number;
        failed: number;
        firstPassFailures: number;
      };
      flaky: { title: string; file: string; statuses: string[] }[];
    };
    expect(reported.total).toMatchObject({
      passed: 1,
      flaky: 1,
      failed: 1,
      firstPassFailures: 2,
    });
    expect(reported.flaky).toEqual([
      expect.objectContaining({
        title: "flaky on purpose",
        file: "fixture.spec.mjs",
        statuses: ["failed", "passed"],
      }),
    ]);
    expect(run.stdout).toContain(
      "::warning file=fixture.spec.mjs,line=3,title=Passed only on retry::flaky on purpose",
    );

    const markdown = readFileSync(stepSummary, "utf8");
    expect(markdown).toContain(
      "### Fixture suite: first-pass and retried results",
    );
    expect(markdown).toContain("| fixture | 3 | 1 | 1 | 1 | 0 | 2 |");
    expect(markdown).toContain(
      "`fixture.spec.mjs:3` flaky on purpose (fixture; attempts: failed → passed)",
    );
  }, 90_000);
});

describe("every Playwright config CI runs loads the reporter", () => {
  it.each([
    ["playwright.config.ts", "E2E (Playwright)"],
    ["playwright.real.config.ts", "Real-Builder E2E"],
    ["playwright.keycloak.config.ts", "Real-Keycloak E2E"],
    ["playwright.multiuser.config.ts", "Multi-user E2E"],
  ])("%s", (config, suite) => {
    expect(readFileSync(join(ROOT, config), "utf8")).toContain(
      `["./scripts/playwright-retry-summary.mjs", { suite: "${suite}" }]`,
    );
  });

  it("keeps the retry count where it was: one in CI for the mock suite, none for the real suites", () => {
    expect(readFileSync(join(ROOT, "playwright.config.ts"), "utf8")).toContain(
      "retries: process.env.CI ? 1 : 0,",
    );
    for (const config of [
      "playwright.real.config.ts",
      "playwright.keycloak.config.ts",
      "playwright.multiuser.config.ts",
    ]) {
      expect(readFileSync(join(ROOT, config), "utf8")).toContain("retries: 0,");
    }
  });

  it("runs the real-Builder workflow on a pull request that changes the reporter", () => {
    const workflow = parse(
      readFileSync(join(ROOT, ".github", "workflows", "real-e2e.yml"), "utf8"),
    ) as {
      on: { pull_request: { paths: string[] } };
    };
    expect(workflow.on.pull_request.paths).toContain(
      "scripts/playwright-retry-summary.mjs",
    );
  });
});
