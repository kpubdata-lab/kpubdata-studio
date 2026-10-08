/**
 * The multi-user half of the real-Builder e2e (#773).
 *
 * `run-real-e2e.mjs` starts Builder in DEV_MODE: one user, no sign-in, keys read from the
 * server. A deployment people sign in to is none of those — Builder verifies an OIDC
 * token, keeps every user's runs apart, and takes provider keys with each request — and
 * a defect that only shows there passed the suite (#767). This starts that deployment:
 *
 * - a stand-in for Keycloak (`scripts/fake-keycloak.mjs`) with two test users;
 * - a second Builder with real OIDC settings pointing at it, its own data directory and
 *   the same replay fixtures, so no network and no service key are needed;
 * - Studio with the OIDC client configured (`playwright.multiuser.config.ts`), and the
 *   specs tagged `@multi-user`.
 *
 * Nothing here is DEV_MODE: Builder refuses to start in DEV_MODE with OIDC configured.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFakeKeycloak } from "./fake-keycloak.mjs";

export const MULTI_USER = {
  builderPort: 8903,
  identityPort: 8904,
  studioPort: 5175,
  realm: "kpubdata-e2e",
  clientId: "kpubdata-studio",
  audience: "kpubdata-builder",
  users: [
    { id: "e2e-alice", email: "alice@e2e.kpubdata.test", name: "Alice" },
    { id: "e2e-bob", email: "bob@e2e.kpubdata.test", name: "Bob" },
  ],
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(command, args, env) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", () => done(1));
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

/**
 * Start the deployment, run the `@multi-user` specs against it, and stop it.
 *
 * @param {{ builderRoot: string, replayArgs: string[] }} options `replayArgs` as the
 *   single-user run passes them to `serve`; empty for a Builder without replay.
 * @returns {Promise<number>} The suite's exit status; 1 when the deployment did not start.
 */
export async function runMultiUserE2e({ builderRoot, replayArgs }) {
  const { builderPort, identityPort, studioPort, realm, clientId, audience, users } = MULTI_USER;
  const studioOrigin = `http://localhost:${studioPort}`;
  const builderUrl = `http://localhost:${builderPort}`;
  const log = (line) => console.log(`[multi-user-e2e] ${line}`);

  const identity = await startFakeKeycloak({
    port: identityPort,
    realm,
    clientId,
    audience,
    allowedOrigin: studioOrigin,
    users,
  });
  const dataDir = mkdtempSync(join(tmpdir(), "kpubdata-multi-user-e2e-"));
  log(`identity provider: ${identity.issuer}`);
  log(`builder data: ${dataDir}`);

  // The single-user run's variables must not reach this Builder: DEV_MODE with OIDC is
  // refused at start, and an API key would be a second way in.
  const inherited = { ...process.env };
  delete inherited.KPUBDATA_BUILDER_DEV_MODE;
  delete inherited.KPUBDATA_BUILDER_API_KEY;
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
      String(builderPort),
      "--warehouse",
      join(dataDir, "warehouse"),
      ...replayArgs,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...inherited,
        // As the workflow and the single-user run do: kpubdata from the lock's pin.
        UV_NO_SOURCES: "1",
        OIDC_ISSUER: identity.issuer,
        OIDC_AUDIENCE: audience,
        OIDC_JWKS_URL: identity.jwksUrl,
        // The allowlist a multi-user Builder will not start without.
        OIDC_ALLOWED_EMAILS: users.map((user) => user.email).join(","),
        KPUBDATA_BUILDER_ALLOWED_ORIGINS: studioOrigin,
      },
    },
  );
  // Read both pipes for as long as Builder runs (#726): a full pipe blocks its next log line.
  builder.stdout.on("data", (chunk) => process.stdout.write(`[builder:multi-user] ${chunk}`));
  builder.stderr.on("data", (chunk) => process.stderr.write(`[builder:multi-user] ${chunk}`));

  const stop = async () => {
    if (builder.exitCode === null) {
      const ended = new Promise((done) => builder.once("exit", done));
      builder.kill("SIGTERM");
      await Promise.race([ended, sleep(10_000)]);
    }
    await identity.close();
  };

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60 && builder.exitCode === null; attempt += 1) {
      try {
        if ((await fetch(`${builderUrl}/healthz`)).ok) {
          healthy = true;
          break;
        }
      } catch {
        // Not listening yet.
      }
      await sleep(500);
    }
    if (!healthy) {
      console.error("[multi-user-e2e] the OIDC Builder did not become healthy");
      return 1;
    }

    // Before a browser is started: is this the deployment the specs assume? A Builder
    // that let an unsigned request in would make every isolation check pass for nothing.
    const unsigned = await fetch(`${builderUrl}/providers`);
    const signed = await fetch(`${builderUrl}/providers`, {
      headers: { Authorization: `Bearer ${identity.accessTokenFor(users[0].id)}` },
    });
    if (unsigned.status !== 401 || signed.status !== 200) {
      console.error(
        `[multi-user-e2e] not a multi-user Builder: GET /providers answered ${unsigned.status} without a token ` +
          `(expected 401) and ${signed.status} with one (expected 200)`,
      );
      return 1;
    }
    log("builder verifies the test realm's tokens and refuses a request without one");

    return await run("npx", ["playwright", "test", "-c", "playwright.multiuser.config.ts"], {
      ...process.env,
      MULTI_USER_E2E: "1",
      REAL_BUILDER_URL: builderUrl,
      MULTI_USER_ISSUER: identity.issuer,
      MULTI_USER_CLIENT_ID: clientId,
      MULTI_USER_STUDIO_PORT: String(studioPort),
      ...(replayArgs.length > 0 ? { REAL_BUILDER_REPLAY: "1" } : {}),
    });
  } finally {
    await stop();
  }
}
