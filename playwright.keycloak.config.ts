import { defineConfig, devices } from "@playwright/test";

/**
 * The real-Keycloak e2e (#903, specs tagged `@keycloak`).
 *
 * Run by `npm run test:e2e:keycloak`: `scripts/run-keycloak-e2e.mjs` starts Keycloak and
 * a mail catcher in Docker, makes the realm, starts a Builder with OIDC pointed at it,
 * then this config. Studio is served with the OIDC client configured and no auth bypass.
 */
const studioPort = process.env.KEYCLOAK_E2E_STUDIO_PORT ?? "5176";

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/keycloak",
  use: {
    baseURL: `http://localhost:${studioPort}`,
    // No trace: one records every request with its headers, and here those carry a
    // signed token and the form posts carry passwords (`scripts/check-e2e-evidence.mjs`).
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
      VITE_BUILDER_API_URL: process.env.REAL_BUILDER_URL ?? "http://localhost:8905",
      VITE_OIDC_ISSUER: process.env.KEYCLOAK_E2E_ISSUER ?? "",
      VITE_OIDC_CLIENT_ID: process.env.KEYCLOAK_E2E_CLIENT_ID ?? "",
    },
  },
  grep: /@keycloak/,

  projects: [{ name: "keycloak-desktop", use: { ...devices["Desktop Chrome"] } }],
});
