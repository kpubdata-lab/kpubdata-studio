/**
 * How the real-e2e runner calls uv, and what it asks a Builder checkout first (#840).
 *
 * Kept apart from `run-real-e2e.mjs` so that it can be tested: the runner starts Builder
 * as soon as it is loaded, and this only answers when asked.
 */
import { spawnSync as nodeSpawnSync } from "node:child_process";

/**
 * The environment of every `uv run` the runner makes.
 *
 * `UV_NO_SOURCES=1` resolves Builder's dependencies from its lock, the way the workflow
 * does (real-e2e.yml sets the same variable). Without it uv tries the editable override
 * Builder's pyproject keeps for local development, and fails where that is not there. A
 * value the caller set is kept: someone who wants that override has said so.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string | undefined>}
 */
export function uvEnvironment(env = process.env) {
  return { ...env, UV_NO_SOURCES: env.UV_NO_SOURCES ?? "1" };
}

/**
 * Ask Builder's CLI rather than its source tree whether it has replay: replay arrived in
 * kpubdata-builder#837, and an older checkout's `serve` does not know the flag.
 *
 * A `uv run` that fails is not an answer to that question. It used to be read as "this
 * Builder checkout has no replay mode"; what uv said is returned instead — or, where uv
 * said nothing because it never ran or was ended, why.
 *
 * @param {string} builderRoot
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   spawnSync?: (
 *     command: string,
 *     args: string[],
 *     options: { encoding: "utf8", env: Record<string, string | undefined> },
 *   ) => { status: number | null, signal?: string | null, error?: Error, stdout: string, stderr: string },
 * }} [options] `spawnSync` is node's unless a test gives its own.
 * @returns {{ ok: true, replayAvailable: boolean } | { ok: false, lines: string[] }}
 */
export function probeBuilder(builderRoot, { env = process.env, spawnSync = nodeSpawnSync } = {}) {
  const asked = spawnSync("uv", ["run", "--project", builderRoot, "kpubdata-builder", "serve", "--help"], {
    encoding: "utf8",
    env: uvEnvironment(env),
  });
  if (asked.status === 0) return { ok: true, replayAvailable: (asked.stdout ?? "").includes("--replay") };

  const lines = [];
  // uv is not installed, or could not be started: there is no output, only this.
  if (asked.error) lines.push(`uv could not be run: ${asked.error.message}`);
  else if (asked.signal) lines.push(`uv run was ended by ${asked.signal}`);
  else lines.push(`uv run exited with status ${asked.status}`);
  const output = (asked.stderr || asked.stdout || "").trim();
  if (output !== "") lines.push(output);
  return { ok: false, lines };
}
