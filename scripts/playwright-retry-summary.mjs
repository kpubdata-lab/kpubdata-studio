/**
 * A Playwright reporter that counts first-pass passes apart from passes on retry (#995).
 *
 * CI runs the mock suite with one retry, so a test that failed and then passed leaves the
 * job green, and the `list` reporter's one "flaky" line is easy to miss. This reporter
 * classifies every test of the run by its attempts:
 *
 * - passed: the first attempt had the expected status;
 * - flaky: the first attempt did not, a retry did (a first-pass failure that recovered);
 * - failed: no attempt did (a hard failure);
 * - skipped.
 *
 * At the end of the run it prints one machine-readable line (`playwright-retry-summary
 * {json}`), appends a table and the flaky tests to the GitHub job summary when
 * `GITHUB_STEP_SUMMARY` is set, and annotates each flaky test as a warning on GitHub
 * Actions. It never changes the run's exit status: a recovered retry is reported, not
 * failed, and a hard failure already fails the run.
 */
import { appendFileSync } from "node:fs";
import { relative } from "node:path";

/** The prefix of the machine-readable line, so a log can be searched for it. */
export const LINE_PREFIX = "playwright-retry-summary";

/**
 * @param {{ statuses: string[]; expectedStatus: string }} test
 * @returns {"passed" | "flaky" | "failed" | "skipped"}
 */
export function classify({ statuses, expectedStatus }) {
  if (statuses.length === 0 || statuses[0] === "skipped") return "skipped";
  if (statuses[0] === expectedStatus) return "passed";
  if (statuses.some((status) => status === expectedStatus)) return "flaky";
  return "failed";
}

/**
 * Counts per project, in the order projects first appear.
 *
 * @param {string} suite
 * @param {{ project: string; file: string; line: number; title: string; statuses: string[]; expectedStatus: string }[]} tests
 */
export function summarize(suite, tests) {
  const projects = new Map();
  const flaky = [];
  const failed = [];
  for (const test of tests) {
    const outcome = classify(test);
    if (!projects.has(test.project)) {
      projects.set(test.project, {
        project: test.project,
        total: 0,
        passed: 0,
        flaky: 0,
        failed: 0,
        skipped: 0,
      });
    }
    const counts = projects.get(test.project);
    counts.total += 1;
    counts[outcome] += 1;
    const entry = {
      project: test.project,
      file: test.file,
      line: test.line,
      title: test.title,
      statuses: test.statuses,
    };
    if (outcome === "flaky") flaky.push(entry);
    if (outcome === "failed") failed.push(entry);
  }
  const rows = [...projects.values()].map((row) => ({
    ...row,
    firstPassFailures: row.flaky + row.failed,
  }));
  const total = {
    project: "total",
    total: 0,
    passed: 0,
    flaky: 0,
    failed: 0,
    skipped: 0,
    firstPassFailures: 0,
  };
  for (const row of rows) {
    for (const key of [
      "total",
      "passed",
      "flaky",
      "failed",
      "skipped",
      "firstPassFailures",
    ])
      total[key] += row[key];
  }
  return { suite, projects: rows, total, flaky, failed };
}

/** @param {{ file: string; line: number; title: string; project: string; statuses: string[] }} test */
function describe(test) {
  return `\`${test.file}:${test.line}\` ${test.title} (${test.project}; attempts: ${test.statuses.join(" → ")})`;
}

/** The job summary section for one run. */
export function renderMarkdown(summary) {
  const lines = [
    `### ${summary.suite}: first-pass and retried results`,
    "",
    "| Project | Tests | Passed first time | Passed only on retry | Failed | Skipped | First-pass failures |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of [...summary.projects, summary.total]) {
    const name =
      row === summary.total ? "**total**" : row.project || "(default)";
    lines.push(
      `| ${name} | ${row.total} | ${row.passed} | ${row.flaky} | ${row.failed} | ${row.skipped} | ${row.firstPassFailures} |`,
    );
  }
  lines.push("");
  if (summary.flaky.length > 0) {
    lines.push(
      `**${summary.flaky.length} test(s) passed only on retry.** They count as first-pass failures, not as first-pass successes; find out why the first attempt failed.`,
      "",
      ...summary.flaky.map((test) => `- ${describe(test)}`),
      "",
    );
  } else {
    lines.push("No test passed only on retry.", "");
  }
  if (summary.failed.length > 0) {
    lines.push(
      `**${summary.failed.length} test(s) failed on every attempt.**`,
      "",
      ...summary.failed.map((test) => `- ${describe(test)}`),
      "",
    );
  }
  return lines.join("\n");
}

/** GitHub Actions warning commands, one per flaky test. */
export function annotations(summary) {
  return summary.flaky.map(
    (test) =>
      `::warning file=${test.file},line=${test.line},title=Passed only on retry::${test.title} (${test.project}) failed its first attempt and passed on retry (${test.statuses.join(" -> ")})`,
  );
}

export default class RetrySummaryReporter {
  /** @param {{ suite?: string; env?: Record<string, string | undefined>; log?: (line: string) => void }} [options] */
  constructor(options = {}) {
    this.suiteName = options.suite ?? "Playwright";
    this.env = options.env ?? process.env;
    this.log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
    this.rootDir = process.cwd();
    this.root = undefined;
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    this.rootDir = config.rootDir;
    this.root = suite;
  }

  onEnd() {
    const all = this.root?.allTests() ?? [];
    // `--list` runs nothing: there is nothing to report.
    if (all.every((test) => test.results.length === 0)) return;
    const tests = all.map((test) => ({
      project: test.parent.project()?.name ?? "",
      file: relative(this.rootDir, test.location.file).split("\\").join("/"),
      line: test.location.line,
      title: test.title,
      statuses: test.results.map((result) => result.status),
      expectedStatus: test.expectedStatus,
    }));
    const summary = summarize(this.suiteName, tests);
    this.log(
      `${LINE_PREFIX} ${JSON.stringify({ suite: summary.suite, projects: summary.projects, total: summary.total, flaky: summary.flaky })}`,
    );
    if (this.env.GITHUB_ACTIONS === "true") {
      for (const line of annotations(summary)) this.log(line);
    }
    if (this.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        this.env.GITHUB_STEP_SUMMARY,
        `${renderMarkdown(summary)}\n`,
      );
    }
  }
}
