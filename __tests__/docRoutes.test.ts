/**
 * The route tables in the docs name routes the router has (#797).
 *
 * INFORMATION_ARCHITECTURE.md's URL table and USER_FLOWS.md's route map had drifted: they
 * listed `/builds/new` and a `/refresh-jobs/new` wizard that had become redirects, and
 * left out a dozen routes. The URL table must now hold every route `src/app/router.tsx`
 * declares and nothing else; the route map may name only routes that exist.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");

/** Every `path: "…"` in the router, as an absolute path. */
function routerPaths(): Set<string> {
  const paths = [...read("src/app/router.tsx").matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1]);
  return new Set(paths.map((path) => (path.startsWith("/") ? path : `/${path}`)));
}

/** The section of a markdown document under `heading`, up to the next `## `. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`no section ${heading}`);
  const next = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, next === -1 ? undefined : next);
}

/** Backticked paths in the first column of each table row. */
function firstColumnPaths(table: string): string[] {
  return table
    .split("\n")
    .filter((line) => line.startsWith("| `/"))
    .flatMap((line) => [...line.split("|")[1].matchAll(/`(\/[^`]*)`/g)].map((m) => m[1]));
}

describe("doc route tables", () => {
  const routes = routerPaths();

  it("reads the router", () => {
    expect(routes.has("/")).toBe(true);
    expect(routes.has("/refresh-jobs/:buildId/publish")).toBe(true);
  });

  it("INFORMATION_ARCHITECTURE lists exactly the router's routes", () => {
    const listed = firstColumnPaths(section(read("INFORMATION_ARCHITECTURE.md"), "## 3. URL 구조"));
    expect([...new Set(listed)].sort()).toEqual([...routes].sort());
  });

  it("USER_FLOWS's route map names only routes that exist", () => {
    const map = section(read("USER_FLOWS.md"), "## 0. 화면 라우트 맵");
    const named = map
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| :--") && !line.startsWith("| 흐름"))
      .flatMap((line) => [...line.split("|")[2].matchAll(/`(\/[^`]*)`/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((path) => !routes.has(path))).toEqual([]);
  });
});
