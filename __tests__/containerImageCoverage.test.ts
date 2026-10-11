/**
 * The container image is scanned, its base images are followed, and a browser is asked
 * whether it may be framed (kpubdata-builder#1107).
 *
 * Nothing scanned the image Studio builds, Dependabot did not read the Dockerfile, and
 * `frame-ancestors 'self'` was checked as text in a header, never by a browser. The
 * scan and the framing check need Docker and run in CI; these hold the configuration
 * that makes them run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const tracked = (...patterns: string[]) =>
  execFileSync("git", ["ls-files", ...patterns], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps: Step[] }> };
type Update = { "package-ecosystem": string; directory?: string; directories?: string[] };

describe("Dependabot and the Dockerfile", () => {
  const updates = (parse(read(".github/dependabot.yml")) as { updates: Update[] }).updates;

  it("follows the base images of every Dockerfile in the repository", () => {
    const followed = updates
      .filter((update) => update["package-ecosystem"] === "docker")
      .flatMap((update) => update.directories ?? [update.directory]);
    const dockerfiles = tracked("Dockerfile", "*/Dockerfile").map((path) => `/${dirname(path)}`.replace("/.", "/"));

    expect(dockerfiles).toEqual(["/"]);
    expect(followed).toEqual(dockerfiles);
  });

  it("turns no auto-merge on: a base image bump is merged by a person", () => {
    const offending = tracked(".github").filter((path) =>
      ["gh pr merge", "--auto", "enablePullRequestAutoMerge", "automerge"].some((word) => read(path).includes(word)),
    );

    expect(tracked(".github")).toContain(".github/dependabot.yml");
    expect(offending).toEqual([]);
  });
});

describe("the image scan in security.yml", () => {
  const steps = (parse(read(".github/workflows/security.yml")) as Workflow).jobs["image-scan"].steps;
  const scans = steps.filter((step) => step.uses?.startsWith("aquasecurity/trivy-action@"));

  it("builds the image from today's base images, not from a cached layer", () => {
    const build = steps.find((step) => step.uses?.startsWith("docker/build-push-action@"));

    expect(build?.with).toMatchObject({ context: ".", load: true, push: false, pull: true });
    for (const scan of scans) expect(scan.with?.["image-ref"]).toBe(build?.with?.tags);
  });

  it("lists every HIGH and CRITICAL finding and fails on one that has a fix", () => {
    expect(scans.map((scan) => scan.with)).toEqual([
      { "image-ref": "kpubdata-studio:scan", severity: "CRITICAL,HIGH", "exit-code": "0", "ignore-unfixed": false },
      { "image-ref": "kpubdata-studio:scan", severity: "CRITICAL,HIGH", "exit-code": "1", "ignore-unfixed": true },
    ]);
  });

  it("runs every week as well as on a change", () => {
    const triggers = (parse(read(".github/workflows/security.yml")) as { on: Record<string, unknown> }).on;

    expect(Object.keys(triggers).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
  });
});

describe("the framing check of the Docker smoke", () => {
  const smoke = read("scripts/docker-csp-smoke.sh");

  it("is given a browser in CI", () => {
    const steps = (parse(read(".github/workflows/ci.yml")) as Workflow).jobs["docker-csp"].steps;
    const step = steps.find((each) => each.run?.includes("docker-csp-smoke.sh"));

    expect(step?.env?.CSP_SMOKE_BROWSER).toBe("google-chrome");
  });

  it("frames the page and the silent SSO page, and one response that must load", () => {
    const frames = [...smoke.matchAll(/<iframe src="([^"]+)">/g)].map((match) => match[1]);

    expect(frames).toEqual([
      "http://localhost:18081/",
      "http://localhost:18081/silent-check-sso.html",
      "http://localhost:18082/config.js",
    ]);
    expect(smoke).toContain('check "the browser refuses to frame the page and silent-check-sso.html" "$refused_a" "2"');
    expect(smoke).toContain('check "the browser frames a response without the policy" "$refused_b" "0"');
  });

  it("says so when it was not run", () => {
    expect(smoke).toContain("Case 4: not run (CSP_SMOKE_BROWSER is not set)");
  });
});
