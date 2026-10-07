import { defineConfig, devices } from "@playwright/test";

/**
 * kpubdata-studio E2E (#268).
 *
 * 결정성 전략: vite dev 서버를 VITE_USE_REAL_BUILDER 미설정(mock)으로 띄운다 —
 * 화면은 deterministic mock fixture로 동작하므로 네트워크·Builder 상태와
 * 무관하게 안정적으로 검증한다. 실 HTTP cross-repo 범위는 kpubdata#282.
 */
/** Where the csp project's production build is written and served (#663). */
const CSP_PREVIEW_DIR = ".csp-preview";
const CSP_PREVIEW_PORT = 4174;
/** Specs that need the production build: the policy (#663) and the locale chunks (#796). */
const BUILT_APP_SPECS = /(csp|locale-loading)\.spec\.ts/;

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
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Mock mode ignores this. It lets a spec that turns the real-Builder path on through
      // the runtime config (and stubs the Builder itself, e.g. sql-explorer) skip the OIDC
      // login it cannot reach — dev builds only (#528).
      env: { VITE_DEV_BYPASS_AUTH: "true" },
    },
    // A production build with the Content-Security-Policy meta, for the csp project (#663).
    // The dev server above sends no policy: React Fast Refresh needs an inline script.
    {
      command: `npx vite build --base / --outDir ${CSP_PREVIEW_DIR} --emptyOutDir --logLevel warn && npx vite preview --base / --outDir ${CSP_PREVIEW_DIR} --port ${CSP_PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${CSP_PREVIEW_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  // @real-builder 스펙(실 Builder 기동 필요)은 기본 슈트에서 제외한다.
  grep: /^(?!.*@real-builder).*$/,
  projects: [
    { name: "desktop-chromium", testIgnore: BUILT_APP_SPECS, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", testIgnore: BUILT_APP_SPECS, use: { ...devices["Pixel 7"] } },
    {
      name: "csp-chromium",
      testMatch: BUILT_APP_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${CSP_PREVIEW_PORT}` },
    },
  ],
});
