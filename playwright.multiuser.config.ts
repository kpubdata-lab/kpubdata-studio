import { defineConfig, devices } from "@playwright/test";

/**
 * The multi-user real-Builder e2e (#773, specs tagged `@multi-user`).
 *
 * Run by `npm run test:e2e:real` after the single-user suite: `scripts/multi-user-e2e.mjs`
 * starts a stand-in identity provider and a Builder with real OIDC settings, then this
 * config. Studio is served with the OIDC client configured and no auth bypass, so every
 * test signs in the way a user does.
 */
const studioPort = process.env.MULTI_USER_STUDIO_PORT ?? "5175";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${studioPort}`,
    // No trace: one records every request with its headers, and here those carry a
    // signed token and a provider key. They are test values, but the workflow refuses
    // to upload any evidence that holds a token (`scripts/check-e2e-evidence.mjs`), so a
    // trace from this suite would cost the single-user suite its evidence too.
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${studioPort} --strictPort`,
    url: `http://localhost:${studioPort}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_USE_REAL_BUILDER: "true",
      VITE_BUILDER_API_URL: process.env.REAL_BUILDER_URL ?? "http://localhost:8903",
      VITE_OIDC_ISSUER: process.env.MULTI_USER_ISSUER ?? "",
      VITE_OIDC_CLIENT_ID: process.env.MULTI_USER_CLIENT_ID ?? "",
    },
  },
  grep: /@multi-user/,

  projects: [{ name: "multi-user-desktop", use: { ...devices["Desktop Chrome"] } }],
});
