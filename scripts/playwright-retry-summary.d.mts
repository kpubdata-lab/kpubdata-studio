/** Types for `playwright-retry-summary.mjs`, so its tests can import it (#995). */
export type Outcome = "passed" | "flaky" | "failed" | "skipped";

export interface TestAttempts {
  project: string;
  file: string;
  line: number;
  title: string;
  statuses: string[];
  expectedStatus: string;
}

export interface ProjectCounts {
  project: string;
  total: number;
  passed: number;
  flaky: number;
  failed: number;
  skipped: number;
  firstPassFailures: number;
}

export interface ListedTest {
  project: string;
  file: string;
  line: number;
  title: string;
  statuses: string[];
}

export interface Summary {
  suite: string;
  projects: ProjectCounts[];
  total: ProjectCounts;
  flaky: ListedTest[];
  failed: ListedTest[];
}

export const LINE_PREFIX: string;
export function classify(
  test: Pick<TestAttempts, "statuses" | "expectedStatus">,
): Outcome;
export function summarize(suite: string, tests: TestAttempts[]): Summary;
export function renderMarkdown(summary: Summary): string;
export function annotations(summary: Summary): string[];
