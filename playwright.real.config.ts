import { defineConfig, devices } from "@playwright/test";

/**
 * cross-repo 실연동 E2E 설정 (kpubdata#282, @real-builder 태그 스펙 전용).
 *
 * 실행: `npm run test:e2e:real` — scripts/run-real-e2e.mjs가
 * KPUBDATA_BUILDER_DEV_MODE=true Builder를 기동한 뒤 이 config로 Playwright를
 * 돌린다. Studio dev 서버는 VITE_USE_REAL_BUILDER=true로 뜬다.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_USE_REAL_BUILDER: "true",
      VITE_BUILDER_API_URL: process.env.REAL_BUILDER_URL ?? "http://localhost:8000",
      VITE_DEV_BYPASS_AUTH: "true",
      // A Studio one minor release behind the Builder under test, so the release-mismatch
      // banner is checked against the real GET /version (#480). The other specs run
      // with it showing, which also checks the banner never blocks a screen.
      KPUBDATA_STUDIO_VERSION: "0.3.0",
    },
  },
  // 이 슈트는 @real-builder 태그 스펙만 실행한다(mock 스펙은 기본 config 담당).
  grep: /@real-builder/,

  projects: [{ name: "real-desktop", use: { ...devices["Desktop Chrome"] } }],
});
