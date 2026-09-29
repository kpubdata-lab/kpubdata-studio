#!/usr/bin/env node
/**
 * cross-repo 실연동 E2E 러너 (kpubdata#282).
 *
 * Studio → 실 Builder HTTP → kpubdata ingestion(file) → manifest 전체 경로를
 * 검증한다. Builder를 KPUBDATA_BUILDER_DEV_MODE=true(인증 생략, dev principal)로
 * 임시 기동하고, Studio를 VITE_USE_REAL_BUILDER=true로 띄운 Playwright
 * real 슈트(@real-builder)를 실행한다. 종료 시 Builder를 정리한다.
 *
 * 사용: node scripts/run-real-e2e.mjs [--builder-root <path>] [--replay-dir <path>] [--keep]
 * 기본 --builder-root는 ../kpubdata-builder. --replay-dir(또는 STUDIO_REPLAY_DIR)는 Builder 가
 * replay 모드로 읽을 fixture 디렉터리다. Studio 는 그 위치를 추측하지 않는다 — 다른 저장소의
 * 내부 구조에 기대지 않기 위해서다(#511). 주지 않으면 Public API 시나리오를 건너뛴다.
 *
 * kpubdata 레포가 있으면 Builder를 **replay 모드**로 띄운다(KPUBDATA_MODE=replay).
 * 기록된 fixture를 재생하므로 Public API source도 외부 네트워크와 data.go.kr
 * 서비스키 없이 결정적으로 빌드된다 — 그 경로를 검증하는 스펙은
 * REAL_BUILDER_REPLAY가 설정될 때만 실행된다. 레포가 없으면 기존처럼
 * file source 시나리오만 돈다.
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
const replayAvailable = replayDir !== null && existsSync(replayDir);

if (!existsSync(join(builderRoot, "pyproject.toml"))) {
  console.error(`builder root not found: ${builderRoot} (pass --builder-root)`);
  process.exit(1);
}

const port = "8902";
const dataDir = mkdtempSync(join(tmpdir(), "kpubdata-real-e2e-"));
console.log(`[real-e2e] builder root: ${builderRoot}`);
console.log(`[real-e2e] builder data: ${dataDir}`);
console.log(
  replayAvailable
    ? `[real-e2e] replay fixtures: ${replayDir}`
    : `[real-e2e] no replay fixtures (--replay-dir / STUDIO_REPLAY_DIR) — Public API 시나리오는 건너뜁니다`,
);

const builder = spawn(
  "uv",
  ["run", "--project", builderRoot, "kpubdata-builder", "serve", "--output-dir", dataDir, "--port", port],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      KPUBDATA_BUILDER_DEV_MODE: "true",
      // Studio dev 서버(5174) 오리진 허용 — CORS는 default-deny(ADR 0006).
      KPUBDATA_BUILDER_ALLOWED_ORIGINS: "http://localhost:5174",
      ...(replayAvailable
        ? {
            KPUBDATA_MODE: "replay",
            KPUBDATA_REPLAY_DIR: replayDir,
            // spec 실행기는 전송 계층에 닿기 전에 provider key를 요구한다. replay는
            // 매칭에서 인증 파라미터를 제외하므로 값 자체는 의미가 없다.
            KPUBDATA_DATAGO_API_KEY: process.env.KPUBDATA_DATAGO_API_KEY ?? "replay-dummy",
          }
        : {}),
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
