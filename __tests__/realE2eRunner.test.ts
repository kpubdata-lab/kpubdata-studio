/**
 * The local real-e2e runner fails loudly and for the real reason (#840).
 *
 * The workflow sets UV_NO_SOURCES so uv resolves Builder's dependencies from its lock;
 * run locally, the runner has to set it itself on both of its uv invocations, and a
 * failing `uv run` has to be reported as what it is instead of "this Builder checkout
 * has no replay mode". The part that decides both is `scripts/real-e2e-probe.mjs`, driven
 * here with a `spawnSync` that answers as uv would.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { probeBuilder, uvEnvironment } from "../scripts/real-e2e-probe.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface UvAnswer {
  status: number | null;
  signal?: string | null;
  error?: Error;
  stdout: string;
  stderr: string;
}

interface UvCall {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

/** A `spawnSync` that answers `answer` and keeps what it was asked. */
function uvThatAnswers(answer: UvAnswer) {
  const calls: UvCall[] = [];
  const spawnSync = (command: string, args: string[], options: { env: Record<string, string | undefined> }): UvAnswer => {
    calls.push({ command, args, env: options.env });
    return answer;
  };
  return { calls, spawnSync };
}

describe("uvEnvironment", () => {
  it("resolves from the lock unless the caller said otherwise", () => {
    expect(uvEnvironment({ PATH: "/bin" })).toEqual({ PATH: "/bin", UV_NO_SOURCES: "1" });
  });

  it("keeps a value the caller set", () => {
    expect(uvEnvironment({ UV_NO_SOURCES: "0" }).UV_NO_SOURCES).toBe("0");
  });
});

describe("probeBuilder", () => {
  it("asks the checkout's own CLI, with dependencies from the lock", () => {
    const uv = uvThatAnswers({ status: 0, stdout: "usage: serve [--replay]", stderr: "" });

    probeBuilder("/builder", { env: { PATH: "/bin" }, spawnSync: uv.spawnSync });

    expect(uv.calls).toEqual([
      {
        command: "uv",
        args: ["run", "--project", "/builder", "kpubdata-builder", "serve", "--help"],
        env: { PATH: "/bin", UV_NO_SOURCES: "1" },
      },
    ]);
  });

  it("finds replay in a checkout that has it, and not in one that does not", () => {
    const withReplay = uvThatAnswers({ status: 0, stdout: "usage: serve [--port PORT] [--replay]", stderr: "" });
    const without = uvThatAnswers({ status: 0, stdout: "usage: serve [--port PORT]", stderr: "" });

    expect(probeBuilder("/builder", { env: {}, spawnSync: withReplay.spawnSync })).toEqual({ ok: true, replayAvailable: true });
    expect(probeBuilder("/builder", { env: {}, spawnSync: without.spawnSync })).toEqual({ ok: true, replayAvailable: false });
  });

  it("reports what uv said when uv run fails, not a checkout without replay", () => {
    const uv = uvThatAnswers({ status: 2, stdout: "", stderr: "error: Distribution not found at: file:///somewhere\n" });

    expect(probeBuilder("/builder", { env: {}, spawnSync: uv.spawnSync })).toEqual({
      ok: false,
      lines: ["uv run exited with status 2", "error: Distribution not found at: file:///somewhere"],
    });
  });

  it("falls back to stdout when uv wrote its error there", () => {
    const uv = uvThatAnswers({ status: 1, stdout: "No such command 'serve'\n", stderr: "" });

    expect(probeBuilder("/builder", { env: {}, spawnSync: uv.spawnSync })).toEqual({
      ok: false,
      lines: ["uv run exited with status 1", "No such command 'serve'"],
    });
  });

  it("says that uv could not be run when it is not installed", () => {
    const uv = uvThatAnswers({ status: null, error: new Error("spawnSync uv ENOENT"), stdout: "", stderr: "" });

    expect(probeBuilder("/builder", { env: {}, spawnSync: uv.spawnSync })).toEqual({
      ok: false,
      lines: ["uv could not be run: spawnSync uv ENOENT"],
    });
  });

  it("says which signal ended uv", () => {
    const uv = uvThatAnswers({ status: null, signal: "SIGKILL", stdout: "", stderr: "" });

    expect(probeBuilder("/builder", { env: {}, spawnSync: uv.spawnSync })).toEqual({
      ok: false,
      lines: ["uv run was ended by SIGKILL"],
    });
  });
});

describe("run-real-e2e.mjs", () => {
  const runner = readFileSync(join(ROOT, "scripts/run-real-e2e.mjs"), "utf8");

  it("asks the probe, and stops on its failure before starting Builder", () => {
    const asked = runner.indexOf("const probe = probeBuilder(builderRoot);");
    const stopped = runner.indexOf("if (!probe.ok) {");
    const started = runner.indexOf("const builder = spawn(");
    expect(asked).toBeGreaterThan(0);
    expect(stopped).toBeGreaterThan(asked);
    expect(started).toBeGreaterThan(stopped);
  });

  it("starts Builder in the same uv environment", () => {
    const started = runner.indexOf("const builder = spawn(");
    expect(runner.slice(started)).toContain("...uvEnvironment(),");
    // Not a second, hard-coded copy of the setting.
    expect(runner).not.toContain("UV_NO_SOURCES:");
  });
});
