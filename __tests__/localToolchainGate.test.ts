/**
 * `git clone && npm ci && npm test` has to work on a fresh machine (studio#431).
 *
 * Two files make that true: `.nvmrc` picks a Node that `engines` accepts, and a
 * repository-scoped `.npmrc` points npm at the registry the lockfile was resolved
 * against. Each can drift from the thing it mirrors without anything noticing, so
 * this test checks both — and checks that the checks fail when they should.
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

describe("local toolchain gate (#431)", () => {
  it(".nvmrc names a Node major that engines accepts", () => {
    const nvmrc = read(".nvmrc").trim();
    const engines = (JSON.parse(read("package.json")) as { engines: { node: string } }).engines.node;
    expect(nvmrc).toMatch(/^\d+$/);
    expect(enginesAdmitMajor(engines, Number(nvmrc))).toBe(true);
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
