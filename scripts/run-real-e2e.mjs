#!/usr/bin/env node
/**
 * cross-repo 실연동 E2E 러너 (kpubdata#282).
 *
 * Studio → 실 Builder HTTP → kpubdata ingestion(file) → manifest 전체 경로를
 * 검증한다. Builder를 KPUBDATA_BUILDER_DEV_MODE=true(인증 생략, dev principal)로
 * 임시 기동하고, Studio를 VITE_USE_REAL_BUILDER=true로 띄운 Playwright
 * real 슈트(@real-builder)를 실행한다. 종료 시 Builder를 정리한다.
 *
 * 그 뒤 같은 Builder 체크아웃을 OIDC 다중 사용자 모드로 한 번 더 띄워 `@multi-user` 스펙을
 * 실행한다(#773, `scripts/multi-user-e2e.mjs`).
 *
 * Usage: node scripts/run-real-e2e.mjs [--builder-root <path>] [--replay-dir <path>] [--keep]
 * The default --builder-root is ../kpubdata-builder.
 *
 * Builder runs in its own replay mode (kpubdata-builder#837), so the public-API scenario
 * builds from a recorded fixture without network access or a service key. By default
 * `serve --replay` uses the fixtures Builder ships; --replay-dir (or STUDIO_REPLAY_DIR) passes
 * a directory as `serve --replay-dir`. Studio sets no kpubdata variable and never looks
 * inside another repository (#511, #541). A Builder checkout without replay support runs
 * the file-source scenarios only.
 *
 * Builder also gets a table catalog (`serve --warehouse`) inside its data directory, so a
 * build commits table snapshots and the warehouse screens (Home, Tables, SQL Workspace,
 * Saved Analyses) talk to a real catalog. Without one, `GET /warehouse/tables` answers 404
 * and the browser logs it as a console error on every screen that asks.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runMultiUserE2e } from "./multi-user-e2e.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const rootIndex = args.indexOf("--builder-root");
const builderRoot = resolve(
  rootIndex !== -1 ? args[rootIndex + 1] : join(process.cwd(), "..", "kpubdata-builder"),
);
const replayIndex = args.indexOf("--replay-dir");
const replayArg = replayIndex !== -1 ? args[replayIndex + 1] : process.env.STUDIO_REPLAY_DIR;
const replayDir = replayArg ? resolve(replayArg) : null;
if (!existsSync(join(builderRoot, "pyproject.toml"))) {
  console.error(`builder root not found: ${builderRoot} (pass --builder-root)`);
  process.exit(1);
}
if (replayDir !== null && !existsSync(replayDir)) {
  console.error(`replay directory not found: ${replayDir}`);
  process.exit(1);
}

// Ask Builder's CLI rather than its source tree: replay arrived in kpubdata-builder#837, and an
// older checkout's `serve` does not know the flag.
const serveHelp = spawnSync("uv", ["run", "--project", builderRoot, "kpubdata-builder", "serve", "--help"], {
  encoding: "utf8",
});
const replayAvailable = serveHelp.status === 0 && serveHelp.stdout.includes("--replay");
const replayArgs = !replayAvailable ? [] : replayDir !== null ? ["--replay-dir", replayDir] : ["--replay"];

const port = "8902";
const dataDir = mkdtempSync(join(tmpdir(), "kpubdata-real-e2e-"));
console.log(`[real-e2e] builder root: ${builderRoot}`);
console.log(`[real-e2e] builder data: ${dataDir}`);
console.log(
  replayAvailable
    ? `[real-e2e] builder replay: ${replayDir ?? "bundled fixtures"}`
    : "[real-e2e] this Builder checkout has no replay mode (kpubdata-builder#837) — skipping the public-API scenario",
);

const builder = spawn(
  "uv",
  [
    "run",
    "--project",
    builderRoot,
    "kpubdata-builder",
    "serve",
    "--output-dir",
    dataDir,
    "--port",
    port,
    "--warehouse",
    join(dataDir, "warehouse"),
    ...replayArgs,
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      KPUBDATA_BUILDER_DEV_MODE: "true",
      // Studio dev 서버(5174) 오리진 허용 — CORS는 default-deny(ADR 0006).
      KPUBDATA_BUILDER_ALLOWED_ORIGINS: "http://localhost:5174",
    },
  },
);
builder.stdout.on("data", (chunk) => process.stdout.write(`[builder] ${chunk}`));
builder.stderr.on("data", (chunk) => process.stderr.write(`[builder] ${chunk}`));

const shutdown = (exitCode) => {
  if (!keep && !builder.killed) builder.kill("SIGTERM");
  process.exit(exitCode);
};
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

// Everything below waits asynchronously, never with spawnSync (#726). Builder's output
// comes through the pipes read by the "data" handlers above, and those run only while
// Node's event loop does: a spawnSync for the Playwright run blocked it for the whole
// suite, and nobody read the pipes. They are Unix sockets, which hold about 278 writes
// whatever their size (measured; Builder wrote only 5–8 KB a run, but a traceback line by
// line). Once full, Builder's next log line blocked — holding the stream's lock, so every
// request thread that logged stopped behind it. Requests then sat unread until the test timed out, late
// in the suite and only on some runs, and none of Builder's output ever reached the log.
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll /healthz until it answers, for up to 30 seconds. */
async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (builder.exitCode !== null) return false;
    try {
      const response = await fetch(`http://localhost:${port}/healthz`);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  return false;
}

/** Run a command with inherited stdio and resolve with its exit status. */
function run(command, commandArgs, env) {
  return new Promise((done) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", env });
    child.on("error", () => done(1));
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

if (!(await waitForHealth())) {
  console.error("[real-e2e] builder did not become healthy");
  shutdown(1);
}

const status = await run("npx", ["playwright", "test", "-c", "playwright.real.config.ts"], {
  ...process.env,
  REAL_BUILDER_E2E: "1",
  REAL_BUILDER_URL: `http://localhost:${port}`,
  ...(replayAvailable ? { REAL_BUILDER_REPLAY: "1" } : {}),
});

// The same Studio against a Builder people sign in to (#773): OIDC, runs kept apart per
// user, provider keys with each request. Run whatever the suite above did, so one run
// reports both, and fail when either does.
const multiUserStatus = await runMultiUserE2e({ builderRoot, replayArgs });

shutdown(status || multiUserStatus);
