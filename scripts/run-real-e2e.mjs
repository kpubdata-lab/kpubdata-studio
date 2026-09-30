#!/usr/bin/env node
/**
 * cross-repo 실연동 E2E 러너 (kpubdata#282).
 *
 * Studio → 실 Builder HTTP → kpubdata ingestion(file) → manifest 전체 경로를
 * 검증한다. Builder를 KPUBDATA_BUILDER_DEV_MODE=true(인증 생략, dev principal)로
 * 임시 기동하고, Studio를 VITE_USE_REAL_BUILDER=true로 띄운 Playwright
 * real 슈트(@real-builder)를 실행한다. 종료 시 Builder를 정리한다.
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
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

// /healthz가 뜰 때까지 폴링(최대 30초).
const ready = spawnSync(
  "bash",
  [
    "-c",
    `for i in $(seq 1 60); do curl -sf http://localhost:${port}/healthz >/dev/null && exit 0; sleep 0.5; done; exit 1`,
  ],
  { stdio: "inherit" },
);
if (ready.status !== 0) {
  console.error("[real-e2e] builder did not become healthy");
  shutdown(1);
}

const e2e = spawnSync(
  "npx",
  ["playwright", "test", "-c", "playwright.real.config.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      REAL_BUILDER_E2E: "1",
      REAL_BUILDER_URL: `http://localhost:${port}`,
      ...(replayAvailable ? { REAL_BUILDER_REPLAY: "1" } : {}),
    },
  },
);

shutdown(e2e.status ?? 1);
