/**
 * Direct real/demo switches can only go down (#902).
 *
 * Each feature has one client interface and one function that picks Builder's or the
 * demo's (#794). `scripts/real-builder-switch.mjs` counts the places that still ask
 * `isRealBuilderEnabled()` themselves and holds them to a shrink-only baseline. These
 * tests show it passing on Studio's own tree and failing when a switch comes back.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BASELINE,
  DEMO_QUERIES,
  SELECTORS,
  countUses,
  demoQueryFindings,
  findings,
  scan,
} from "../scripts/real-builder-switch.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("the direct-switch counter", () => {
  it("counts a call, and the function passed on, but not an import or a comment", () => {
    const source = [
      'import { isRealBuilderEnabled } from "@/shared/lib/builderApi";',
      "// isRealBuilderEnabled() is not asked here",
      "/** `isRealBuilderEnabled()` in a doc comment */",
      "if (isRealBuilderEnabled()) run();",
      "const check = isRealBuilderEnabled;",
      'const text = "isRealBuilderEnabled()";',
    ].join("\n");
    expect(countUses("f.ts", source)).toBe(2);
  });

  it("reads TSX", () => {
    expect(countUses("f.tsx", "export const A = () => <p>{isRealBuilderEnabled() ? 1 : 2}</p>;")).toBe(1);
  });

  it("does not count the declaration", () => {
    expect(countUses("f.ts", 'export function isRealBuilderEnabled(): boolean { return env === "true"; }')).toBe(0);
  });
});

describe("the ratchet", () => {
  const selectors = { "src/a/client.ts": "aClient()" };
  const baseline = { "src/pages/B.tsx": 2 };

  it("passes when the counts match", () => {
    expect(findings({ "src/a/client.ts": 1, "src/pages/B.tsx": 2 }, selectors, baseline)).toEqual([]);
  });

  it("fails on a new file that switches for itself", () => {
    const found = findings({ "src/a/client.ts": 1, "src/pages/B.tsx": 2, "src/pages/C.tsx": 1 }, selectors, baseline);
    expect(found).toEqual([expect.stringContaining("src/pages/C.tsx: 1 new use(s)")]);
  });

  it("fails when a file's count grows", () => {
    expect(findings({ "src/a/client.ts": 1, "src/pages/B.tsx": 3 }, selectors, baseline)).toEqual([
      expect.stringContaining("src/pages/B.tsx: 3 uses, baseline 2"),
    ]);
  });

  it("fails when a count drops and the baseline was not lowered with it", () => {
    expect(findings({ "src/a/client.ts": 1, "src/pages/B.tsx": 1 }, selectors, baseline)).toEqual([
      expect.stringContaining("lower the baseline to 1"),
    ]);
    expect(findings({ "src/a/client.ts": 1 }, selectors, baseline)).toEqual([
      expect.stringContaining("lower the baseline to 0"),
    ]);
  });

  it("fails on a selector with more than one use, or none", () => {
    expect(findings({ "src/a/client.ts": 2, "src/pages/B.tsx": 2 }, selectors, baseline)).toEqual([
      expect.stringContaining("a selector holds exactly one"),
    ]);
    expect(findings({ "src/pages/B.tsx": 2 }, selectors, baseline)).toEqual([
      expect.stringContaining("remove it from SELECTORS"),
    ]);
  });
});

describe("the isDemo() list", () => {
  it("counts the function, not a member of the same name", () => {
    const source = [
      'import { isDemo } from "@/shared/lib/demoMode";',
      "if (isDemo()) skip();",
      "const turn = { isDemo: true };",
      "if (turn.isDemo) note();",
      "interface Turn { isDemo?: boolean }",
    ].join("\n");
    expect(countUses("f.ts", source, "isDemo")).toBe(1);
  });

  const allowed = { "src/app/Shell.tsx": 1 };

  it("passes when the files and counts match", () => {
    expect(demoQueryFindings({ "src/app/Shell.tsx": 1 }, allowed)).toEqual([]);
  });

  it("fails when a screen not listed asks it, or a listed one asks it more", () => {
    expect(demoQueryFindings({ "src/app/Shell.tsx": 1, "src/pages/Data.tsx": 1 }, allowed)).toEqual([
      expect.stringContaining("src/pages/Data.tsx: 1 new isDemo() use(s)"),
    ]);
    expect(demoQueryFindings({ "src/app/Shell.tsx": 2 }, allowed)).toEqual([
      expect.stringContaining("2 isDemo() uses, listed 1"),
    ]);
  });

  it("fails when a listed file stops asking and the list was not lowered", () => {
    expect(demoQueryFindings({}, allowed)).toEqual([expect.stringContaining("lower DEMO_QUERIES to 0")]);
  });
});

describe("Studio's tree", () => {
  it("matches the isDemo() list", () => {
    expect(demoQueryFindings(scan(REPO, "isDemo"))).toEqual([]);
    expect(Object.keys(DEMO_QUERIES).length).toBeGreaterThan(0);
  });

  it("matches the selectors and the baseline", () => {
    expect(findings(scan(REPO))).toEqual([]);
  });

  it("no file is both a selector and a baseline entry", () => {
    expect(Object.keys(SELECTORS).filter((file) => file in BASELINE)).toEqual([]);
  });

  it("the script exits 0 on the tree", () => {
    const out = execFileSync("node", [join(REPO, "scripts", "real-builder-switch.mjs")], { encoding: "utf8" });
    expect(out).toMatch(/^Direct isRealBuilderEnabled\(\) uses: \d+ in \d+ files/m);
  });
});
