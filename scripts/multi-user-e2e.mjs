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
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFakeKeycloak } from "./fake-keycloak.mjs";
import { uvEnvironment } from "./real-e2e-probe.mjs";

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
 * @returns {Promise<number>} The suite's exit status; 1 when the deployment did not start,
 *   is not one that verifies tokens, or wrote a user's provider key to its output.
 */
export async function runMultiUserE2e({ builderRoot, replayArgs }) {
  const { builderPort, identityPort, studioPort, realm, clientId, audience, users } = MULTI_USER;
  const studioOrigin = `http://localhost:${studioPort}`;
  const builderUrl = `http://localhost:${builderPort}`;
  const log = (line) => console.log(`[multi-user-e2e] ${line}`);

  // The provider key a test user types. A value of this run only, and one that holds the
  // workflow's canary when there is one: the evidence check reads Builder's output and
  // whatever a failed run leaves behind for the canary, so this key anywhere in them is
  // found by value (`scripts/check-e2e-evidence.mjs`).
  const sessionKey = `${process.env.CANARY_KEY ?? `e2e-canary-local-${randomUUID()}`}-alice-session`;
  let keyInBuilderOutput = false;
  const relay = (stream) => (chunk) => {
    if (String(chunk).includes(sessionKey)) keyInBuilderOutput = true;
    stream.write(`[builder:multi-user] ${String(chunk).split(sessionKey).join("<redacted>")}`);
  };

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
      // PyJWT: Builder verifies tokens with it and will not start with OIDC set without it.
      "--extra",
      "auth",
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
        // As the workflow and the single-user run do: dependencies from the lock, unless
        // the caller set UV_NO_SOURCES (`real-e2e-probe.mjs`).
        ...uvEnvironment(inherited),
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
  builder.stdout.on("data", relay(process.stdout));
  builder.stderr.on("data", relay(process.stderr));
  // The runner leaves through `process.exit` — on Ctrl-C too — and a child outlives that.
  const killOnExit = () => {
    if (builder.exitCode === null) builder.kill("SIGTERM");
  };
  process.once("exit", killOnExit);

  const stop = async () => {
    process.removeListener("exit", killOnExit);
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
    // that let a request in without a token, or with one it had not verified, would make
    // every isolation check pass for nothing.
    const refused = identity.tokensToRefuse(users[0].id);
    const ask = async (token) =>
      (await fetch(`${builderUrl}/providers`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status;
    const answers = {
      "without a token": [await ask(null), 401],
      "with a token signed by another key": [await ask(refused.signedByAnotherKey), 401],
      "with a token for another audience": [await ask(refused.forAnotherAudience), 401],
      "with a token of the test realm": [await ask(identity.accessTokenFor(users[0].id)), 200],
    };
    const wrong = Object.entries(answers).filter(([, [got, expected]]) => got !== expected);
    if (wrong.length > 0) {
      console.error(
        "[multi-user-e2e] not a Builder that verifies tokens: GET /providers answered " +
          wrong.map(([how, [got, expected]]) => `${got} ${how} (expected ${expected})`).join(", "),
      );
      return 1;
    }
    log("builder verifies the test realm's tokens: no token, another key and another audience are refused");

    const status = await run("npx", ["playwright", "test", "-c", "playwright.multiuser.config.ts"], {
      ...process.env,
      MULTI_USER_E2E: "1",
      MULTI_USER_SESSION_KEY: sessionKey,
      REAL_BUILDER_URL: builderUrl,
      MULTI_USER_ISSUER: identity.issuer,
      MULTI_USER_CLIENT_ID: clientId,
      MULTI_USER_STUDIO_PORT: String(studioPort),
      ...(replayArgs.length > 0 ? { REAL_BUILDER_REPLAY: "1" } : {}),
    });
    if (keyInBuilderOutput) {
      // Said without the key: this line is in the log the evidence check reads.
      console.error("[multi-user-e2e] Builder wrote a user's provider key to its output");
      return 1;
    }
    return status;
  } finally {
    await stop();
  }
}
