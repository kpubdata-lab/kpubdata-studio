/**
 * `git clone && npm ci && npm test` has to work on a fresh machine (studio#431).
 *
 * Two files make that true: `.nvmrc` picks a Node that `engines` accepts, and a
 * repository-scoped `.npmrc` points npm at the registry the lockfile was resolved
 * against. Each can drift from the thing it mirrors without anything noticing, so
 * this test checks both — and checks that the checks fail when they should.
 *
 * The Dockerfile's build stage is a third copy of the Node choice: the site that ships
 * is built there, so its Node major must be the LTS line `.nvmrc` names and CI's test
 * matrix runs (#981).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

/** Majors `engines.node` admits, e.g. `^22.13.0 || >=24` → 22 admits, 20 does not. */
function enginesAdmitMajor(range: string, major: number): boolean {
  return range.split("||").some((part) => {
    const clause = part.trim();
    const caret = /^\^(\d+)\./.exec(clause);
    if (caret) return Number(caret[1]) === major;
    const atLeast = /^>=\s*(\d+)/.exec(clause);
    if (atLeast) return major >= Number(atLeast[1]);
    return false;
  });
}

/** Tracked `.npmrc` must carry no credential — those belong in `~/.npmrc`. */
function hasCredential(npmrc: string): boolean {
  return /(_authToken|_auth|_password|username)\s*=/i.test(npmrc);
}

function registryOf(npmrc: string): string | undefined {
  const line = npmrc
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("registry="));
  return line?.slice("registry=".length).replace(/\/?$/, "/");
}

/** Every distinct `scheme://host/` a lockfile entry was resolved from. */
function lockfileRegistries(lock: string): Set<string> {
  const hosts = new Set<string>();
  for (const m of lock.matchAll(/"resolved":\s*"(https?:\/\/[^/"]+\/)/g)) {
    hosts.add(m[1]);
  }
  return hosts;
}

/** The Node major of the Dockerfile's `node:<major>…` build stage, or undefined. */
function dockerNodeMajor(dockerfile: string): number | undefined {
  const m = /^FROM\s+(?:--\S+\s+)*node:(\d+)\b.*\bAS\s+build\s*$/im.exec(dockerfile);
  return m ? Number(m[1]) : undefined;
}

/** Every Node major the CI test matrix lists as `- node-version: "<major>"`. */
function ciMatrixMajors(workflow: string): number[] {
  return [...workflow.matchAll(/^\s*-\s*node-version:\s*["']?(\d+)["']?\s*$/gm)].map((m) => Number(m[1]));
}

/** Node release lines with an even major become LTS; an odd one never does. */
function isLtsMajor(major: number): boolean {
  return major % 2 === 0;
}

describe("local toolchain gate (#431)", () => {
  it(".nvmrc names a Node major that engines accepts", () => {
    const nvmrc = read(".nvmrc").trim();
    const engines = (JSON.parse(read("package.json")) as { engines: { node: string } }).engines.node;
    expect(nvmrc).toMatch(/^\d+$/);
    expect(enginesAdmitMajor(engines, Number(nvmrc))).toBe(true);
  });

  it("the Dockerfile builds with the LTS Node major .nvmrc names and CI tests (#981)", () => {
    const docker = dockerNodeMajor(read("Dockerfile"));
    const nvmrc = Number(read(".nvmrc").trim());
    const matrix = ciMatrixMajors(read(".github/workflows/ci.yml"));
    expect(matrix.length).toBeGreaterThan(0);
    expect(docker).toBe(nvmrc);
    expect(matrix).toContain(docker);
    expect(isLtsMajor(docker as number)).toBe(true);
  });

  it(".npmrc points at the one registry the lockfile resolves from", () => {
    const hosts = lockfileRegistries(read("package-lock.json"));
    expect([...hosts]).toEqual([registryOf(read(".npmrc"))]);
  });

  it(".npmrc carries no credential", () => {
    expect(hasCredential(read(".npmrc"))).toBe(false);
  });

  describe("the checks fail when they should", () => {
    it("rejects a Node major outside engines", () => {
      expect(enginesAdmitMajor("^22.13.0 || >=24", 20)).toBe(false);
      expect(enginesAdmitMajor("^22.13.0 || >=24", 23)).toBe(false);
      expect(enginesAdmitMajor("^22.13.0 || >=24", 26)).toBe(true);
    });

    it("reads the build stage's Node major, and nothing from a stage that is not it", () => {
      expect(dockerNodeMajor("FROM --platform=$BUILDPLATFORM node:25-alpine AS build\n")).toBe(25);
      expect(dockerNodeMajor("FROM node:24.11-alpine3.22 AS build\n")).toBe(24);
      expect(dockerNodeMajor("FROM node:22-alpine AS deps\nFROM nginx:1 AS build\n")).toBeUndefined();
    });

    it("rejects a Dockerfile Node major CI does not test or that is not LTS", () => {
      const matrix = ciMatrixMajors('        include:\n          - node-version: "22"\n          - node-version: "24"\n');
      expect(matrix).toEqual([22, 24]);
      expect(matrix).not.toContain(25);
      expect(isLtsMajor(25)).toBe(false);
      expect(matrix).not.toContain(20);
    });

    it("sees a registry the lockfile does not use", () => {
      const lock = '{"resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz"}';
      const feed = registryOf("registry=https://packagefeedproxy.example/npm/");
      expect([...lockfileRegistries(lock)]).not.toEqual([feed]);
    });

    it("sees a credential in .npmrc", () => {
      expect(hasCredential("//registry.npmjs.org/:_authToken=npm_abc\n")).toBe(true);
    });

    it("sees an .npmrc with no registry line", () => {
      expect(registryOf("fund=false\n")).toBeUndefined();
    });
  });
});
