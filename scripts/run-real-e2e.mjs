#!/usr/bin/env node
/**
 * cross-repo 실연동 E2E 러너 (kpubdata#282).
 *
 * Studio → 실 Builder HTTP → Builder ingestion(file · public API) → manifest 전체 경로를
 * 검증한다. Builder를 KPUBDATA_BUILDER_DEV_MODE=true(인증 생략, dev principal)로
 * 띄우고 real 슈트(@real-builder)를 실행한다. 종료 시 Builder를 정리한다.
 *
 * 사용: node scripts/run-real-e2e.mjs [--builder-root <path>] [--replay-dir <path>] [--keep]
 * 기본 --builder-root는 ../kpubdata-builder.
 *
 * Public API 시나리오는 Builder 의 replay 모드로 돈다 (#541, kpubdata-builder#837):
 * 옵션이 없으면 `serve --replay`(Builder 패키지에 포함된 fixture), --replay-dir(또는
 * STUDIO_REPLAY_DIR)을 주면 `serve --replay-dir DIR`. Studio 는 kpubdata 의 설정 이름을
 * 모른다 — replay 를 켜는 것은 Builder 의 옵션이다 (#511). `--replay` 를 모르는 이전
 * Builder 체크아웃이면 경고하고 file 시나리오만 돌린다.
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
if (replayDir !== null && !existsSync(replayDir)) {
  console.error(`replay fixture directory not found: ${replayDir}`);
  process.exit(1);
}

if (!existsSync(join(builderRoot, "pyproject.toml"))) {
  console.error(`builder root not found: ${builderRoot} (pass --builder-root)`);
  process.exit(1);
}

// Whether this Builder checkout can replay on its own (kpubdata-builder#837).
const serveHelp = spawnSync("uv", ["run", "--project", builderRoot, "kpubdata-builder", "serve", "--help"], {
  encoding: "utf8",
});
const replaySupported = /--replay\b/.test(`${serveHelp.stdout}${serveHelp.stderr}`);
const replayArgs = !replaySupported ? [] : replayDir ? ["--replay-dir", replayDir] : ["--replay"];

const port = "8902";
const dataDir = mkdtempSync(join(tmpdir(), "kpubdata-real-e2e-"));
console.log(`[real-e2e] builder root: ${builderRoot}`);
console.log(`[real-e2e] builder data: ${dataDir}`);
console.log(
  !replaySupported
    ? "[real-e2e] this Builder has no `serve --replay` (kpubdata-builder#837) — Public API 시나리오는 건너뜁니다"
    : replayDir
      ? `[real-e2e] replay fixtures: ${replayDir}`
      : "[real-e2e] replay fixtures: bundled with Builder (serve --replay)",
);

const builder = spawn(
  "uv",
  ["run", "--project", builderRoot, "kpubdata-builder", "serve", "--output-dir", dataDir, "--port", port, ...replayArgs],
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
      ...(replaySupported ? { REAL_BUILDER_REPLAY: "1" } : {}),
    },
  },
);

shutdown(e2e.status ?? 1);
