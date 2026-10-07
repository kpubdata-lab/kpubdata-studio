/**
 * The real-Builder e2e workflow and the evidence check it relies on (#726).
 *
 * The check must refuse each kind of credential a trace or a log can carry, so most of
 * these feed it one and expect a finding. The workflow is read as YAML: it has to run
 * the suite, check the evidence before uploading it, and stay out of `CI gate`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { canaries, main, scan, scanText } from "../scripts/check-e2e-evidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANARY = "e2e-canary-123-1-key";

// Credential-shaped samples are assembled when the test runs, so the source holds no
// string a secret scanner would report (gitleaks reads every commit).
const b64url = (text: string) => Buffer.from(text).toString("base64url");
const JWT = [b64url('{"alg":"RS256"}'), b64url('{"sub":"user-1"}'), b64url("signature-value")].join(".");
const SAMPLE = ["abcdef", "123456"].join("");
const BEARER = ["Bear", "er"].join("");
const SERVICE_KEY = ["service", "Key"].join("");
const DART_KEY = ["crtfc", "_key"].join("");

describe("scanText", () => {
  it.each([
    ["JWT", `{"access_token":"${JWT}"}`],
    ["bearer token", `authorization: ${BEARER} ${SAMPLE}${SAMPLE}`],
    ["X-Provider-Key value", `{"name":"x-provider-key","value":"datago=${SAMPLE}"}`],
    ["X-Provider-Key value", `X-Provider-Key: datago=${SAMPLE}`],
    ["provider key in a URL", `GET https://apis.data.go.kr/x?${SERVICE_KEY}=${SAMPLE}&pageNo=1`],
    ["provider key in a URL", `https://opendart.fss.or.kr/api/list.json?${DART_KEY}=${SAMPLE}${SAMPLE}`],
  ])("finds a %s", (kind, text) => {
    expect(scanText(text)).toContain(kind);
  });

  it("finds a canary by value, whatever surrounds it", () => {
    expect(scanText(`[builder] params={'key': '${CANARY}'}`, [CANARY])).toEqual(["canary secret"]);
  });

  it.each([
    `authorization: ${BEARER} <redacted>`,
    '{"name":"x-provider-key","value":"<redacted>"}',
    `https://apis.data.go.kr/x?${SERVICE_KEY}=<redacted>&pageNo=1`,
    `https://apis.data.go.kr/x?${SERVICE_KEY}=%3Credacted%3E`,
    "X-Provider-Key: ***",
    // Ordinary output the suite produces.
    "GET http://localhost:5174/src/main.tsx?t=1791335133852 200",
    "ws://localhost:5174/?token=UNU2JZE1fLt1",
    '{"run_id":"ui-public-api-1791335133852","status":"ok"}',
    `${BEARER} token required`,
  ])("passes text with nothing to hide: %s", (text) => {
    expect(scanText(text, [CANARY])).toEqual([]);
  });
});

describe("canaries", () => {
  it("splits the list and drops values too short to match safely", () => {
    expect(canaries(` ${CANARY}, short ,,another-long-value`)).toEqual([CANARY, "another-long-value"]);
    expect(canaries(undefined)).toEqual([]);
  });
});

describe("scan and main", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-evidence-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads every text file under a directory and skips images", () => {
    mkdirSync(join(dir, "test-results", "spec", "trace.unpacked"), { recursive: true });
    writeFileSync(join(dir, "test-results", "spec", "trace.unpacked", "0-trace.network"), `{"key":"${CANARY}"}`);
    writeFileSync(join(dir, "test-results", "spec", "test-failed-1.png"), CANARY);
    writeFileSync(join(dir, "real-e2e.log"), "9 passed");

    const findings = scan([join(dir, "real-e2e.log"), join(dir, "test-results"), join(dir, "missing")], [CANARY]);

    expect(findings).toEqual([
      { path: join(dir, "test-results", "spec", "trace.unpacked", "0-trace.network"), kinds: ["canary secret"] },
    ]);
  });

  it("exits 1 on a finding, 0 without one, 2 without a path", () => {
    const log = join(dir, "real-e2e.log");
    writeFileSync(log, `[builder] key=${CANARY}`);
    expect(main([log], { E2E_CANARY_SECRETS: CANARY })).toBe(1);

    writeFileSync(log, "[builder] key=<redacted>");
    expect(main([log], { E2E_CANARY_SECRETS: CANARY })).toBe(0);

    expect(main([], {})).toBe(2);
  });
});

describe("real-e2e.yml", () => {
  type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string> };
  const workflow = parse(readFileSync(join(ROOT, ".github", "workflows", "real-e2e.yml"), "utf8")) as {
    on: { schedule?: unknown; workflow_dispatch?: unknown; pull_request?: { paths: string[] } };
    jobs: { "real-e2e": { steps: Step[]; env: Record<string, string> } };
  };
  const steps = workflow.jobs["real-e2e"].steps;
  const step = (name: string) => {
    const found = steps.filter((s) => s.name === name);
    expect(found, name).toHaveLength(1);
    return found[0];
  };

  it("runs nightly, by hand and on a pull request that changes the suite", () => {
    expect(workflow.on.schedule).toBeDefined();
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.on.pull_request?.paths).toEqual(
      expect.arrayContaining(["e2e/real-*.spec.ts", "scripts/run-real-e2e.mjs", "playwright.real.config.ts"]),
    );
  });

  it("runs the suite against a Builder checkout with a canary key", () => {
    const run = step("Run the real-Builder suite");
    expect(run.run).toContain("node scripts/run-real-e2e.mjs --builder-root .builder");
    expect(run.run).toContain("set -o pipefail");
    // What matters is that Builder is given the value the evidence check looks for, not
    // which variable carries it (Studio names no kpubdata setting, #511).
    expect(Object.values(run.env ?? {})).toContain("${{ env.CANARY_KEY }}");
    expect(step("Check the evidence for credentials").env?.E2E_CANARY_SECRETS).toBe("${{ env.CANARY_KEY }}");
    expect(workflow.jobs["real-e2e"].env.UV_NO_SOURCES).toBe("1");
  });

  it("uploads evidence only after the credential check passed on it", () => {
    const check = step("Check the evidence for credentials");
    const upload = step("Upload the evidence");

    expect(steps.indexOf(check)).toBeLessThan(steps.indexOf(upload));
    expect(check.run).toContain("node scripts/check-e2e-evidence.mjs real-e2e.log test-results");
    expect(check.env?.E2E_CANARY_SECRETS).toBe("${{ env.CANARY_KEY }}");
    expect(upload.if).toBe(`failure() && steps.${check.id}.outcome == 'success'`);
  });

  it("checks a passing run's log too", () => {
    expect(step("Check the log of a passing run for credentials").if).toBe("success()");
  });

  it("is not a job CI gate waits for", () => {
    const ci = parse(readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as {
      jobs: Record<string, { needs?: string[] }>;
    };
    const needs = Object.values(ci.jobs).flatMap((job) => job.needs ?? []);
    expect(needs).not.toContain("real-e2e");
  });
});

describe("run-real-e2e.mjs", () => {
  // Builder's output reaches the log through pipes the runner's event loop reads. A
  // spawnSync once Builder is running blocks that loop: Builder's stderr fills (a Unix
  // socket holds about 278 writes, whatever their size), its next log line blocks with
  // the stream's lock held, and every request thread that logs stops behind it. That was
  // the suite's intermittent hang late in a run (#726).
  const source = readFileSync(join(ROOT, "scripts", "run-real-e2e.mjs"), "utf8");

  it("never waits synchronously once Builder is started", () => {
    const started = source.indexOf("const builder = spawn(");
    expect(started).toBeGreaterThan(0);
    expect(source.slice(started)).not.toMatch(/\bspawnSync\(|\bexecSync\(|\bexecFileSync\(/);
  });

  it("reads Builder's output while the suite runs", () => {
    expect(source).toContain('builder.stdout.on("data"');
    expect(source).toContain('builder.stderr.on("data"');
  });
});
