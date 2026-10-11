#!/usr/bin/env node
/**
 * The real-Keycloak half of the real-Builder e2e (#903).
 *
 * `multi-user-e2e.mjs` signs in through a stand-in identity provider that signs in
 * whoever is asked for. Sign-up, e-mail verification and the administrator's approval
 * happen in Keycloak and in Builder's sign-up ledger, so this starts both for real:
 *
 * - Keycloak and a mail catcher (Mailpit) in Docker, by pinned image digests, on a
 *   network of their own; the realm is made through the admin API
 *   (`scripts/keycloak-realm.mjs`) with sign-up and Verify email on and one administrator;
 * - a Builder with OIDC pointed at that realm, no allowlist and that administrator as
 *   `KPUBDATA_BUILDER_ADMIN_SUBJECTS`, so a new account waits as `pending` until approved;
 * - a control address on localhost that restarts this Builder on the same data
 *   directory, for the spec that restarts it under a signed-in session;
 * - Studio with the OIDC client configured (`playwright.keycloak.config.ts`), and the
 *   specs tagged `@keycloak`.
 *
 * Usage: node scripts/run-keycloak-e2e.mjs [--builder-root <path>]
 * Needs Docker and uv. The default --builder-root is ../kpubdata-builder.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { setUpRealm } from "./keycloak-realm.mjs";
import { uvEnvironment } from "./real-e2e-probe.mjs";

/** Pinned by digest: a tag can be moved to another image without a change here. */
const IMAGES = {
  keycloak:
    "quay.io/keycloak/keycloak:26.7.4@sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c",
  mailpit: "axllent/mailpit:v1.31.2@sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d",
};

const KEYCLOAK_E2E = {
  keycloakPort: 8180,
  mailPort: 8025,
  builderPort: 8905,
  controlPort: 8906,
  studioPort: 5176,
  realm: "kpubdata-e2e",
  clientId: "kpubdata-studio",
  audience: "kpubdata-builder",
  administrator: { email: "admin@e2e.kpubdata.test", firstName: "Ada", lastName: "Admin" },
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (line) => console.log(`[keycloak-e2e] ${line}`);

/** Run a command and resolve with its exit status and output. */
function run(command, args, { env = process.env, quiet = false } = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit", env });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("error", (cause) => done({ status: 1, output: String(cause) }));
    child.on("exit", (code, signal) => done({ status: code ?? (signal ? 1 : 0), output }));
  });
}

async function docker(args) {
  const answer = await run("docker", args, { quiet: true });
  if (answer.status !== 0) throw new Error(`docker ${args[0]} failed: ${answer.output.trim()}`);
  return answer.output.trim();
}

/** Poll `url` until it answers 2xx, for up to `seconds`. */
async function waitFor(url, seconds, stillRunning = () => true) {
  for (let waited = 0; waited < seconds * 2 && stillRunning(); waited += 1) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--builder-root");
  const builderRoot = resolve(rootIndex !== -1 ? args[rootIndex + 1] : join(process.cwd(), "..", "kpubdata-builder"));
  if (!existsSync(join(builderRoot, "pyproject.toml"))) {
    console.error(`builder root not found: ${builderRoot} (pass --builder-root)`);
    return 1;
  }

  const { keycloakPort, mailPort, builderPort, controlPort, studioPort, realm, clientId, audience } = KEYCLOAK_E2E;
  const keycloakUrl = `http://localhost:${keycloakPort}`;
  const mailUrl = `http://localhost:${mailPort}`;
  const builderUrl = `http://localhost:${builderPort}`;
  const studioOrigin = `http://localhost:${studioPort}`;
  // Passwords of this run's throwaway realm, built around the workflow's canary when there
  // is one, so that the evidence check finds them by value in anything a failed run leaves.
  const secretBase = process.env.CANARY_KEY ?? `e2e-canary-local-${randomUUID()}`;
  const administrator = { ...KEYCLOAK_E2E.administrator, password: `${secretBase}-admin-pw` };
  const memberPassword = `${secretBase}-member-pw`;
  const bootstrap = { username: "bootstrap", password: `${secretBase}-bootstrap-pw` };

  const suffix = randomUUID().slice(0, 8);
  const network = `kpubdata-e2e-${suffix}`;
  const containers = { keycloak: `kpubdata-e2e-keycloak-${suffix}`, mailpit: `kpubdata-e2e-mailpit-${suffix}` };
  const dataDir = mkdtempSync(join(tmpdir(), "kpubdata-keycloak-e2e-"));
  log(`builder root: ${builderRoot}`);
  log(`builder data: ${dataDir}`);

  /** @type {import("node:child_process").ChildProcess | null} */
  let builder = null;
  let control = null;
  let status = 1;

  const startBuilder = (issuer, administratorId) => {
    // The other suites' variables must not reach this Builder: DEV_MODE with OIDC is
    // refused at start, and an API key would be a second way in.
    const inherited = { ...process.env };
    delete inherited.KPUBDATA_BUILDER_DEV_MODE;
    delete inherited.KPUBDATA_BUILDER_API_KEY;
    const child = spawn(
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
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...uvEnvironment(inherited),
          OIDC_ISSUER: issuer,
          OIDC_AUDIENCE: audience,
          OIDC_JWKS_URL: `${issuer}/protocol/openid-connect/certs`,
          // No OIDC_ALLOWED_* list: a new account is recorded as pending and waits for
          // this administrator, the only one, who is admitted by being one.
          KPUBDATA_BUILDER_ADMIN_SUBJECTS: `${issuer}|${administratorId}`,
          KPUBDATA_BUILDER_ALLOWED_ORIGINS: studioOrigin,
        },
      },
    );
    // Read both pipes for as long as Builder runs (#726): a full pipe blocks its next log line.
    child.stdout.on("data", (chunk) => process.stdout.write(`[builder:keycloak] ${chunk}`));
    child.stderr.on("data", (chunk) => process.stderr.write(`[builder:keycloak] ${chunk}`));
    return child;
  };

  const stopBuilder = async () => {
    if (builder && builder.exitCode === null && builder.signalCode === null) {
      const ended = new Promise((done) => builder.once("exit", done));
      builder.kill("SIGTERM");
      await Promise.race([ended, sleep(15_000)]);
    }
  };

  const builderHealthy = () => waitFor(`${builderUrl}/healthz`, 60, () => builder?.exitCode === null);

  // The runner can leave through `process.exit` — on Ctrl-C too — and the children outlive it.
  const killOnExit = () => {
    if (builder && builder.exitCode === null) builder.kill("SIGTERM");
  };
  process.once("exit", killOnExit);

  try {
    await docker(["network", "create", network]);
    await docker([
      "run", "-d", "--rm", "--name", containers.mailpit, "--network", network, "--network-alias", "mailpit",
      "-p", `127.0.0.1:${mailPort}:8025`, IMAGES.mailpit,
    ]);
    await docker([
      "run", "-d", "--rm", "--name", containers.keycloak, "--network", network,
      "-p", `127.0.0.1:${keycloakPort}:8080`,
      "-e", `KC_BOOTSTRAP_ADMIN_USERNAME=${bootstrap.username}`,
      "-e", `KC_BOOTSTRAP_ADMIN_PASSWORD=${bootstrap.password}`,
      IMAGES.keycloak, "start-dev",
    ]);
    if (!(await waitFor(`${keycloakUrl}/realms/master`, 180))) throw new Error("Keycloak did not start");
    if (!(await waitFor(`${mailUrl}/api/v1/info`, 60))) throw new Error("Mailpit did not start");
    log(`keycloak: ${keycloakUrl}, mail: ${mailUrl}`);

    const { issuer, administratorId } = await setUpRealm({
      baseUrl: keycloakUrl,
      bootstrap,
      realm,
      clientId,
      audience,
      studioOrigin,
      smtp: { host: "mailpit", port: 1025, from: "noreply@e2e.kpubdata.test" },
      administrator,
    });
    log(`realm ${realm} made through the admin API; issuer ${issuer}`);

    builder = startBuilder(issuer, administratorId);
    if (!(await builderHealthy())) throw new Error("the Keycloak Builder did not become healthy");

    // Before a browser starts: a Builder that let a request in without a token would make
    // every check below pass for nothing.
    const anonymous = (await fetch(`${builderUrl}/providers`)).status;
    if (anonymous !== 401) throw new Error(`Builder answered GET /providers without a token with ${anonymous}, not 401`);

    // The spec restarts Builder through this, on the same data directory and settings.
    control = createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/builder/restart") {
        response.writeHead(404).end();
        return;
      }
      void (async () => {
        log("restarting Builder");
        await stopBuilder();
        builder = startBuilder(issuer, administratorId);
        const healthy = await builderHealthy();
        log(healthy ? "Builder is back" : "Builder did not come back");
        response.writeHead(healthy ? 200 : 500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ restarted: healthy }));
      })();
    });
    await new Promise((done) => control.listen(controlPort, "127.0.0.1", done));

    const suite = await run("npx", ["playwright", "test", "-c", "playwright.keycloak.config.ts"], {
      env: {
        ...process.env,
        KEYCLOAK_E2E: "1",
        REAL_BUILDER_URL: builderUrl,
        KEYCLOAK_E2E_ISSUER: issuer,
        KEYCLOAK_E2E_CLIENT_ID: clientId,
        KEYCLOAK_E2E_STUDIO_PORT: String(studioPort),
        KEYCLOAK_E2E_MAIL_URL: mailUrl,
        KEYCLOAK_E2E_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
        KEYCLOAK_E2E_ADMIN_EMAIL: administrator.email,
        KEYCLOAK_E2E_ADMIN_PASSWORD: administrator.password,
        KEYCLOAK_E2E_MEMBER_PASSWORD: memberPassword,
      },
    });
    status = suite.status;
  } catch (cause) {
    console.error(`[keycloak-e2e] ${cause instanceof Error ? cause.message : String(cause)}`);
    status = 1;
  } finally {
    if (status !== 0) {
      const tail = await run("docker", ["logs", "--tail", "60", containers.keycloak], { quiet: true });
      if (tail.output) console.error(`[keycloak-e2e] Keycloak's last lines:\n${tail.output}`);
    }
    control?.close();
    process.removeListener("exit", killOnExit);
    await stopBuilder();
    for (const name of Object.values(containers)) await run("docker", ["rm", "-f", name], { quiet: true });
    await run("docker", ["network", "rm", network], { quiet: true });
  }
  return status;
}

process.exit(await main());
