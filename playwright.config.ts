import { defineConfig, devices } from "@playwright/test";

/**
 * kpubdata-studio E2E (#268).
 *
 * 결정성 전략: vite dev 서버를 VITE_USE_REAL_BUILDER 미설정(mock)으로 띄운다 —
 * 화면은 deterministic mock fixture로 동작하므로 네트워크·Builder 상태와
 * 무관하게 안정적으로 검증한다. 실 HTTP cross-repo 범위는 kpubdata#282.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  // 파일 병렬 실행은 하지 않는다 — 여러 worker가 단일 vite dev 서버의
  // 온디맨드 트랜스파일을 경합해 뒤쪽 route의 첫 로드가 expect 타임아웃을
  // 넘긴다(#268 리뷰에서 확인 — 직렬로만 전 스펙이 100% 통과).
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Mock mode ignores this. It lets a spec that turns the real-Builder path on through
    // the runtime config (and stubs the Builder itself, e.g. sql-explorer) skip the OIDC
    // login it cannot reach — dev builds only (#528).
    env: { VITE_DEV_BYPASS_AUTH: "true" },
  },
  // @real-builder 스펙(실 Builder 기동 필요)은 기본 슈트에서 제외한다.
  grep: /^(?!.*@real-builder).*$/,
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
