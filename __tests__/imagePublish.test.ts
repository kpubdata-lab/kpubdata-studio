/**
 * A release publishes the Studio image, and only one job may write packages (#904).
 *
 * The publish runs only on a release, so a pull request cannot see it happen; these
 * hold the configuration that makes it happen, and the dry run in image.yml builds what
 * it would build.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = {
  if?: string;
  needs?: string | string[];
  uses?: string;
  with?: Record<string, unknown>;
  permissions?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };

const release = parse(read(".github/workflows/release.yml")) as Workflow;
const image = parse(read(".github/workflows/image.yml")) as Workflow;
const builds = (job: Job) => (job.steps ?? []).filter((step) => step.uses?.startsWith("docker/build-push-action@"));

describe("release.yml", () => {
  it("calls image.yml with the release tag after tagging, and publishes", () => {
    expect(release.jobs.image).toMatchObject({
      needs: ["release"],
      uses: "./.github/workflows/image.yml",
      with: { ref: "${{ needs.release.outputs.tag }}", publish: true },
    });
  });

  it("grants packages: write to the image job and to no other", () => {
    const writers = Object.entries(release.jobs)
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([name]) => name);

    expect(release.permissions).toEqual({ contents: "read" });
    expect(writers).toEqual(["image"]);
  });

  it("fails the release when no digest came back", () => {
    const step = release.jobs["image-published"].steps?.[0];

    expect(release.jobs["image-published"].needs).toEqual(["release", "image"]);
    expect(step?.env?.DIGEST).toBe("${{ needs.image.outputs.digest }}");
    expect(step?.run).toContain("exit 1");
  });
});

describe("image.yml", () => {
  it("is a dry run on a pull request and a publish only when called with publish", () => {
    expect(Object.keys(image.on).sort()).toEqual(["pull_request", "workflow_call"]);
    expect(image.permissions).toEqual({ contents: "read" });
    expect(image.jobs.publish.if).toBe("inputs.publish");
    expect(image.jobs.confirm.if).toBe("inputs.publish");
  });

  it("pushes nothing and logs in nowhere outside the publish and confirm jobs", () => {
    const build = image.jobs.build;

    expect(build.permissions).toBeUndefined();
    expect((build.steps ?? []).some((step) => step.uses?.startsWith("docker/login-action@"))).toBe(false);
    for (const step of builds(build)) expect(step.with?.push).toBe(false);
  });

  it("builds in the dry run exactly what it publishes", () => {
    const published = builds(image.jobs.publish);
    const dryRun = builds(image.jobs.build)[0];
    const same = ["context", "platforms", "sbom", "provenance"];
    const pick = (step: Step | undefined) => Object.fromEntries(same.map((key) => [key, step?.with?.[key]]));

    expect(published).toHaveLength(1);
    expect(published[0].with).toMatchObject({ push: true, platforms: "linux/amd64,linux/arm64", sbom: true, provenance: "mode=max" });
    expect(pick(dryRun)).toEqual(pick(published[0]));
  });

  it("writes packages only in the publish job, and reads them only in the confirm job", () => {
    expect(image.jobs.publish.permissions).toEqual({ contents: "read", packages: "write" });
    expect(image.jobs.confirm.permissions).toEqual({ contents: "read", packages: "read" });
  });

  it("starts the image against Builder in the dry run and the published image after a publish", () => {
    const smoke = (job: Job) => (job.steps ?? []).find((step) => step.run?.includes("docker-builder-smoke.sh"));

    expect(smoke(image.jobs.build)?.env?.STUDIO_IMAGE).toBe("kpubdata-studio:smoke");
    expect(smoke(image.jobs.confirm)?.env?.STUDIO_IMAGE).toBe(
      "ghcr.io/kpubdata-lab/kpubdata-studio@${{ needs.publish.outputs.digest }}",
    );
  });
});
