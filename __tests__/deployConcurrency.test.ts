/**
 * The Pages workflow keeps other runs out of the deploy concurrency group (#586), and
 * does not run on a pull request at all (#835).
 *
 * GitHub keeps one pending run per concurrency group. When pull requests and main
 * deploys shared `pages`, a pull request run waiting in it was replaced by the next run
 * and cancelled without a job, so the then-required `build` check never reported. A
 * pull request is now held to the app and docs builds by ci.yml, behind the `CI gate`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = parse(readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8")) as {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": string | boolean };
  jobs: Record<string, { name?: string; if?: string }>;
};

type Context = { event_name: string; ref: string };

/**
 * Evaluates the two GitHub expression forms this workflow uses, so the test checks the
 * group each event lands in rather than the expression's spelling.
 */
function evaluate(value: string | boolean, ctx: Context): string | boolean {
  if (typeof value === "boolean") return value;
  const m = /^\$\{\{\s*(.*?)\s*\}\}$/.exec(value);
  if (!m) return value;
  const expr = m[1];
  const ternary =
    /^github\.event_name == '([^']+)' && '([^']+)' \|\| format\('([^']*)\{0\}', github\.ref\)$/.exec(expr);
  if (ternary) {
    return ctx.event_name === ternary[1] ? ternary[2] : `${ternary[3]}${ctx.ref}`;
  }
  const eq = /^github\.event_name == '([^']+)'$/.exec(expr);
  if (eq) return ctx.event_name === eq[1];
  throw new Error(`deploy.yml concurrency uses an expression this test cannot read: ${expr}`);
}

const group = (ctx: Context) => evaluate(workflow.concurrency.group, ctx);
const cancels = (ctx: Context) => evaluate(workflow.concurrency["cancel-in-progress"], ctx);

const mainPush = { event_name: "push", ref: "refs/heads/main" };

describe("Pages deploy concurrency (#586)", () => {
  it("serialises main deploys in one group and never cancels one in progress", () => {
    expect(group(mainPush)).toBe("pages");
    expect(cancels(mainPush)).toBe(false);
  });

  it("does not run on a pull request", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
  });

  it("keeps a manual dispatch out of the deploy group", () => {
    expect(group({ event_name: "workflow_dispatch", ref: "refs/heads/main" })).not.toBe("pages");
  });

  it("deploys only from a push to main", () => {
    expect(workflow.jobs.deploy.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
  });

  it("has no job left that only reported a required check", () => {
    // `build` existed only because branch protection required a check by that name.
    expect(Object.keys(workflow.jobs).sort()).toEqual(["deploy", "site"]);
  });
});
