import test from "node:test";
import assert from "node:assert/strict";
import { assets, check, load, packagesFromLock, trackedFiles } from "./license-inventory.mjs";

function inventoryCopy() {
  return structuredClone(load());
}

test("repository inventory and served notice are current", () => {
  assert.deepEqual(check(load()), []);
});

test("a lock entry without an inventory record fails", () => {
  const inventory = inventoryCopy();
  delete inventory.packages[Object.keys(inventory.packages)[0]];
  assert.ok(check(inventory).some((problem) => problem.includes("npm lock entries")));
});

test("a changed license declaration fails", () => {
  const inventory = inventoryCopy();
  inventory.packages[Object.keys(inventory.packages)[0]].license = "changed";
  assert.ok(check(inventory).some((problem) => problem.includes("npm lock entries")));
});

test("a new visual asset requires a declared group", () => {
  const inventory = inventoryCopy();
  assert.ok(check(inventory, [...trackedFiles(), "public/unknown.svg"]).some((problem) => problem.includes("public/unknown.svg")));
});

test("a stale asset group fails", () => {
  const inventory = inventoryCopy();
  const files = trackedFiles().filter((path) => !path.startsWith("e2e/visual.spec.ts-snapshots/"));
  assert.ok(check(inventory, files).some((problem) => problem.includes("visual-test-baselines")));
});

test("a stale notice fails", () => {
  const inventory = inventoryCopy();
  inventory.assets = assets.slice(1);
  assert.ok(check(inventory).some((problem) => problem.includes("THIRD_PARTY_NOTICES")));
});

test("non-plain npm declaration stays for review", () => {
  const packages = packagesFromLock({ packages: { "node_modules/example": { version: "1.0.0", license: "GPL-3.0-only", resolved: "https://example.test" } } });
  assert.equal(packages["node_modules/example"].status, "needs review");
});
