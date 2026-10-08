/**
 * The stand-in for Keycloak that the multi-user e2e signs in through (#773).
 *
 * The suite's isolation checks mean something only if this behaves as an identity
 * provider does where it matters: a token is signed by the key it publishes, a code is
 * good once and only with its PKCE verifier, and a code is never sent to another origin.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { http, passthrough } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startFakeKeycloak } from "../scripts/fake-keycloak.mjs";
import { mswServer } from "../vitest.setup";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STUDIO = "http://localhost:5999";
const PORT = 8961;
const BASE = `http://localhost:${PORT}/realms/test/protocol/openid-connect`;
const VERIFIER = "a-verifier-long-enough-to-be-one-0123456789";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

type Realm = Awaited<ReturnType<typeof startFakeKeycloak>>;
let realm: Realm | undefined;

async function start(): Promise<Realm> {
  realm = await startFakeKeycloak({
    port: PORT,
    realm: "test",
    clientId: "studio",
    audience: "builder",
    allowedOrigin: STUDIO,
    users: [
      { id: "alice", email: "alice@example.test", name: "Alice" },
      { id: "carol", email: "carol@example.test", name: "Carol", emailVerified: false },
    ],
  });
  return realm;
}

beforeEach(() => {
  // The realm is a real server on this machine: let requests to it through the mock network.
  mswServer.use(http.all(`http://localhost:${PORT}/*`, () => passthrough()));
});

afterEach(async () => {
  await realm?.close();
  realm = undefined;
});

function authUrl(extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    client_id: "studio",
    response_type: "code",
    redirect_uri: `${STUDIO}/login`,
    state: "state-1",
    nonce: "nonce-1",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...extra,
  });
  return `${BASE}/auth?${query.toString()}`;
}

/** Where the realm sent the browser, and what it put in the fragment. */
async function redirected(url: string, cookie?: string): Promise<{ target: URL; answer: URLSearchParams; cookie: string }> {
  const response = await fetch(url, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  expect(response.status).toBe(302);
  const target = new URL(response.headers.get("location") ?? "");
  return {
    target,
    answer: new URLSearchParams(target.hash.slice(1)),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}

async function exchange(form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}/token`, { method: "POST", body: new URLSearchParams(form) });
  const body: unknown = await response.json();
  return { status: response.status, body: typeof body === "object" && body !== null ? { ...body } : {} };
}

function claims(token: unknown): Record<string, unknown> {
  const payload: unknown = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
  return typeof payload === "object" && payload !== null ? { ...payload } : {};
}

async function signInAs(user: string): Promise<{ code: string; cookie: string }> {
  const { answer, cookie } = await redirected(authUrl({ fake_user: user }));
  return { code: answer.get("code") ?? "", cookie };
}

function codeGrant(code: string, verifier = VERIFIER): Record<string, string> {
  return { grant_type: "authorization_code", client_id: "studio", code, redirect_uri: `${STUDIO}/login`, code_verifier: verifier };
}

describe("the test realm", () => {
  it("signs its tokens with the key it publishes, and says who and for whom", async () => {
    const started = await start();
    const { code } = await signInAs("alice");

    const { status, body } = await exchange(codeGrant(code));

    expect(status).toBe(200);
    const [header, payload, signature] = String(body.access_token).split(".");
    const jwks: unknown = await (await fetch(started.jwksUrl)).json();
    const keys = typeof jwks === "object" && jwks !== null && "keys" in jwks && Array.isArray(jwks.keys) ? jwks.keys : [];
    expect(keys).toHaveLength(1);
    const key = createPublicKey({ key: keys[0], format: "jwk" });
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, "base64url"))).toBe(true);
    expect(claims(body.access_token)).toMatchObject({
      iss: started.issuer,
      aud: "builder",
      sub: "alice",
      email: "alice@example.test",
      email_verified: true,
    });
    // What keycloak-js checks before it calls the sign-in done, and decodes afterwards.
    expect(claims(body.id_token)).toMatchObject({ nonce: "nonce-1", aud: "studio" });
    expect(String(body.refresh_token).split(".")).toHaveLength(3);
  });

  it("takes a code once, and only with the verifier of its challenge", async () => {
    await start();
    const first = await signInAs("alice");
    expect((await exchange(codeGrant(first.code, "another-verifier-of-the-same-length-000000"))).status).toBe(400);
    // The failed attempt spent the code.
    expect((await exchange(codeGrant(first.code))).status).toBe(400);

    const second = await signInAs("alice");
    expect((await exchange(codeGrant(second.code))).status).toBe(200);
    expect((await exchange(codeGrant(second.code))).body).toStrictEqual({ error: "invalid_grant" });
  });

  it("sends a code to Studio's own origin and nowhere else", async () => {
    await start();

    for (const elsewhere of ["http://evil.test/login", `${STUDIO}.evil.test/login`, "javascript:alert(1)", ""]) {
      const response = await fetch(authUrl({ fake_user: "alice", redirect_uri: elsewhere }), { redirect: "manual" });
      expect(response.status, elsewhere).toBe(400);
    }
    expect((await fetch(authUrl({ fake_user: "alice", client_id: "another-client" }), { redirect: "manual" })).status).toBe(400);
  });

  it("answers a silent check with login_required until someone has signed in", async () => {
    await start();

    const before = await redirected(authUrl({ prompt: "none" }));
    expect(before.target.origin).toBe(STUDIO);
    expect(Object.fromEntries(before.answer)).toMatchObject({ error: "login_required", state: "state-1" });
    expect(before.answer.has("code")).toBe(false);

    const { cookie } = await signInAs("alice");
    const after = await redirected(authUrl({ prompt: "none" }), cookie);
    const tokens = await exchange(codeGrant(after.answer.get("code") ?? ""));
    expect(claims(tokens.body.access_token).sub).toBe("alice");
  });

  it("asks who to sign in when nobody is, without signing anyone in", async () => {
    await start();

    const response = await fetch(authUrl(), { redirect: "manual" });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    const page = await response.text();
    expect(page).toContain('data-fake-user="alice"');
    expect(page).toContain('data-fake-user="carol"');
  });

  it("renews a session from its refresh token, once", async () => {
    await start();
    const { code } = await signInAs("alice");
    const first = await exchange(codeGrant(code));
    const refresh = { grant_type: "refresh_token", client_id: "studio", refresh_token: String(first.body.refresh_token) };

    const renewed = await exchange(refresh);

    expect(renewed.status).toBe(200);
    expect(claims(renewed.body.access_token)).toMatchObject({ sub: "alice", aud: "builder" });
    expect((await exchange(refresh)).status).toBe(400);
  });

  it("can say an address is not verified, as Builder must be able to refuse", async () => {
    await start();
    const { code } = await signInAs("carol");

    expect(claims((await exchange(codeGrant(code))).body.access_token).email_verified).toBe(false);
  });

  it("makes tokens a verifying Builder must refuse: another key's signature, another audience", async () => {
    const started = await start();
    const jwks: unknown = await (await fetch(started.jwksUrl)).json();
    const keys = typeof jwks === "object" && jwks !== null && "keys" in jwks && Array.isArray(jwks.keys) ? jwks.keys : [];
    const published = createPublicKey({ key: keys[0], format: "jwk" });
    const verified = (token: string): boolean => {
      const [header, payload, signature] = token.split(".");
      return verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), published, Buffer.from(signature, "base64url"));
    };

    const refused = started.tokensToRefuse("alice");

    // Every claim as a good token has it; only the signature is not the realm's.
    expect(claims(refused.signedByAnotherKey)).toMatchObject({ iss: started.issuer, aud: "builder", sub: "alice", email_verified: true });
    expect(verified(refused.signedByAnotherKey)).toBe(false);
    // The realm's own signature, for someone else.
    expect(verified(refused.forAnotherAudience)).toBe(true);
    expect(claims(refused.forAnotherAudience).aud).toBe("builder-other");
    expect(verified(started.accessTokenFor("alice"))).toBe(true);
  });

  it("lets Studio's origin read its answers, with the session cookie, and no other", async () => {
    await start();

    const response = await fetch(`${BASE}/token`, { method: "POST", body: new URLSearchParams({ client_id: "studio" }) });

    expect(response.headers.get("access-control-allow-origin")).toBe(STUDIO);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("the real-e2e runner", () => {
  const runner = readFileSync(join(ROOT, "scripts/run-real-e2e.mjs"), "utf8");
  const multiUser = readFileSync(join(ROOT, "scripts/multi-user-e2e.mjs"), "utf8");

  it("runs the multi-user suite too, and fails when either suite does", () => {
    expect(runner).toContain("await runMultiUserE2e({ builderRoot, replayArgs }).catch(");
    expect(runner).toContain("shutdown(status || multiUserStatus)");
  });

  it("starts that Builder with OIDC and never in DEV_MODE", () => {
    for (const setting of ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "OIDC_ALLOWED_EMAILS"]) {
      expect(multiUser).toContain(`${setting}:`);
    }
    expect(multiUser).toContain("delete inherited.KPUBDATA_BUILDER_DEV_MODE");
    expect(multiUser).toContain("delete inherited.KPUBDATA_BUILDER_API_KEY");
    // PyJWT comes with the extra: without it an OIDC Builder does not start.
    expect(multiUser).toMatch(/"--extra",\s+"auth",/);
    // And refuses to go on against a Builder that does not verify what it is sent.
    for (const how of ["without a token", "with a token signed by another key", "with a token for another audience"]) {
      expect(multiUser).toContain(`"${how}": [await ask(`);
    }
    // A user's key in Builder's output fails the run, and is not repeated in saying so.
    expect(multiUser).toContain("if (keyInBuilderOutput)");
    expect(multiUser).toContain('.split(sessionKey).join("<redacted>")');
  });

  it("keeps the multi-user specs out of the suites that have no such Builder", () => {
    expect(readFileSync(join(ROOT, "playwright.config.ts"), "utf8")).toContain("@(real-builder|multi-user)");
    expect(readFileSync(join(ROOT, "playwright.real.config.ts"), "utf8")).toContain("grep: /@real-builder/");
    const multiUserConfig = readFileSync(join(ROOT, "playwright.multiuser.config.ts"), "utf8");
    expect(multiUserConfig).toContain("grep: /@multi-user/");
    // Its own directory: a run empties the one it writes to, and the single-user run's
    // evidence of a failure is in `test-results/`.
    expect(multiUserConfig).toContain('outputDir: "test-results/multi-user"');
    expect(multiUserConfig).toContain('trace: "off"');
  });
});
