import { defineConfig, devices } from "@playwright/test";

/**
 * kpubdata-studio E2E (#268).
 *
 * Determinism: the app is built without VITE_USE_REAL_BUILDER, so it runs on the mock
 * fixtures and does not depend on the network or on a Builder. The real-HTTP cross-repo
 * scope is kpubdata#282.
 */
/** Where the production build most projects run against is written and served (#663, #901). */
const PREVIEW_DIR = ".csp-preview";
const PREVIEW_PORT = 4174;
const DEV_PORT = 5173;
/** Specs that need the production build: the policy (#663) and the locale chunks (#796). */
const BUILT_APP_SPECS = /(csp|locale-loading)\.spec\.ts/;
/**
 * Specs that turn the real-Builder path on through the runtime config and stub the Builder
 * themselves. They skip the sign-in through VITE_DEV_BYPASS_AUTH, which only a dev build
 * honours (#528), so they run on the dev server, one worker at a time (#901).
 */
const DEV_SERVER_SPECS = /(home|sql-explorer|table-detail|tables)\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "retain-on-failure",
  },
  // The built app behind `vite preview` has nothing to transpile, so several workers can
  // share it (#901). The dev server transpiles on demand: several workers contended on it
  // and the first load of a later route outran the expect timeout (#268). `npm run
  // test:e2e` therefore runs the dev-server projects in a second pass with one worker.
  fullyParallel: false,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 4,
  webServer: [
    {
      command: `npx vite build --base / --outDir ${PREVIEW_DIR} --emptyOutDir --logLevel warn && npx vite preview --base / --outDir ${PREVIEW_DIR} --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Mock mode ignores this. It lets a spec that turns the real-Builder path on through
      // the runtime config (and stubs the Builder itself) skip the OIDC login it cannot
      // reach — dev builds only (#528).
      env: { VITE_DEV_BYPASS_AUTH: "true" },
    },
  ],
  // @real-builder specs (they need a running Builder) are left out of the default suite.
  // @multi-user specs need a Builder with OIDC and an identity provider as well (#773).
  // @keycloak specs need Docker for Keycloak and a mail catcher (#903).
  grep: /^(?!.*@(real-builder|multi-user|keycloak)).*$/,
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: [BUILT_APP_SPECS, DEV_SERVER_SPECS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testIgnore: [BUILT_APP_SPECS, DEV_SERVER_SPECS],
      use: { ...devices["Pixel 7"] },
    },
    { name: "csp-chromium", testMatch: BUILT_APP_SPECS, use: { ...devices["Desktop Chrome"] } },
    {
      name: "desktop-dev",
      testMatch: DEV_SERVER_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEV_PORT}` },
    },
    {
      name: "mobile-dev",
      testMatch: DEV_SERVER_SPECS,
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${DEV_PORT}` },
    },
  ],
});
