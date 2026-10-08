/**
 * A stand-in for Keycloak, for the multi-user real-Builder e2e (#773).
 *
 * Studio signs in with keycloak-js (Authorization Code + PKCE) and Builder verifies the
 * access token against the issuer's signing keys. This serves just enough of a realm for
 * both, with a signing key made when it starts — so the suite needs no container and no
 * secret, and Builder is started with real OIDC settings instead of DEV_MODE:
 *
 * - `…/protocol/openid-connect/auth` — signs in. Without a session it shows one link per
 *   test user; `prompt=none` (keycloak-js's silent check) answers `login_required`.
 * - `…/token` — exchanges the code (PKCE S256 is checked) or a refresh token for an
 *   RS256 access token carrying `iss`, `aud`, `sub`, `email` and `email_verified`.
 * - `…/certs` — the JWKS Builder's `OIDC_JWKS_URL` reads.
 * - `…/logout`, and the third-party-cookie probe keycloak-js loads before a silent check.
 *
 * It is a test double: it signs in whoever is asked for, and must never be reachable
 * from anything but the test it was started for. It listens on localhost only.
 */
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";

const SESSION_COOKIE = "fake_kc_user";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * @param {{
 *   port: number,
 *   realm: string,
 *   clientId: string,
 *   audience: string,
 *   allowedOrigin: string,
 *   users: Array<{ id: string, email: string, name: string, emailVerified?: boolean }>,
 *   accessTokenSeconds?: number,
 * }} options
 */
export async function startFakeKeycloak(options) {
  const { port, realm, clientId, audience, allowedOrigin, users } = options;
  const accessTokenSeconds = options.accessTokenSeconds ?? 300;
  const issuer = `http://localhost:${port}/realms/${realm}`;
  const base = `/realms/${realm}/protocol/openid-connect`;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  /** Authorization codes waiting to be exchanged, once each. */
  const codes = new Map();
  /** Refresh tokens → what they renew. */
  const refreshTokens = new Map();

  function jwt(claims, signingKey = privateKey) {
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
    const payload = base64url(JSON.stringify(claims));
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), signingKey);
    return `${header}.${payload}.${base64url(signature)}`;
  }

  function tokensFor(user, nonce, sessionId, { tokenAudience = audience, signingKey = privateKey } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const common = {
      iss: issuer,
      sub: user.id,
      iat: now,
      exp: now + accessTokenSeconds,
      sid: sessionId,
      azp: clientId,
      email: user.email,
      email_verified: user.emailVerified ?? true,
      preferred_username: user.email,
      name: user.name,
      ...(nonce ? { nonce } : {}),
    };
    // A JWT like the others: keycloak-js decodes the refresh token to read its expiry.
    const refreshToken = jwt({ iss: issuer, aud: issuer, sub: user.id, typ: "Refresh", iat: now, exp: now + 1800, sid: sessionId, jti: randomUUID() });
    refreshTokens.set(refreshToken, { user, nonce, sessionId });
    return {
      access_token: jwt({ ...common, typ: "Bearer", aud: tokenAudience, jti: randomUUID() }, signingKey),
      id_token: jwt({ ...common, typ: "ID", aud: clientId, jti: randomUUID() }),
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: accessTokenSeconds,
      refresh_expires_in: 1800,
      session_state: sessionId,
      scope: "openid email profile",
    };
  }

  function cors(response) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    response.setHeader("Vary", "Origin");
  }

  function send(response, status, body, headers = {}) {
    // One request per connection: a client that kept one open would find it closed
    // when the realm is stopped and started again on the same port.
    response.writeHead(status, { "Cache-Control": "no-store", Connection: "close", ...headers });
    response.end(body);
  }

  function json(response, status, body) {
    cors(response);
    send(response, status, JSON.stringify(body), { "Content-Type": "application/json" });
  }

  function sessionUser(request) {
    const cookie = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === SESSION_COOKIE);
    return cookie ? users.find((user) => user.id === decodeURIComponent(cookie[1])) : undefined;
  }

  /** Only Studio's own pages are redirected to: an open redirect would hand a code to anyone. */
  function redirectTarget(raw) {
    try {
      const url = new URL(raw ?? "");
      return url.origin === allowedOrigin ? url : null;
    } catch {
      return null;
    }
  }

  function redirectWith(response, target, mode, params, headers = {}) {
    const answer = new URLSearchParams(params).toString();
    if (mode === "query") target.search = answer;
    else target.hash = answer;
    send(response, 302, "", { Location: target.toString(), ...headers });
  }

  function authorize(request, response, url) {
    const query = url.searchParams;
    const target = redirectTarget(query.get("redirect_uri"));
    if (!target || query.get("client_id") !== clientId || query.get("response_type") !== "code") {
      return send(response, 400, "invalid authorization request");
    }
    const mode = query.get("response_mode") === "query" ? "query" : "fragment";
    const state = query.get("state") ?? "";
    const chosen = users.find((user) => user.id === query.get("fake_user"));
    const user = chosen ?? sessionUser(request);
    if (!user) {
      if (query.get("prompt") === "none") {
        return redirectWith(response, target, mode, { error: "login_required", state, iss: issuer });
      }
      const links = users
        .map((candidate) => {
          const next = new URL(url);
          next.searchParams.set("fake_user", candidate.id);
          return `<li><a data-fake-user="${escapeHtml(candidate.id)}" href="${escapeHtml(next.pathname + next.search)}">${escapeHtml(candidate.email)}</a></li>`;
        })
        .join("");
      return send(
        response,
        200,
        `<!doctype html><meta charset="utf-8"><title>Sign in (test realm)</title><h1>Sign in to ${escapeHtml(realm)}</h1><ul>${links}</ul>`,
        { "Content-Type": "text/html; charset=utf-8" },
      );
    }
    const code = randomUUID();
    const sessionId = randomUUID();
    codes.set(code, {
      user,
      sessionId,
      nonce: query.get("nonce"),
      challenge: query.get("code_challenge"),
      redirectUri: query.get("redirect_uri"),
    });
    redirectWith(response, target, mode, { state, session_state: sessionId, iss: issuer, code }, {
      "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(user.id)}; Path=/; HttpOnly; SameSite=Lax`,
    });
  }

  async function token(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if (form.get("client_id") !== clientId) return json(response, 400, { error: "invalid_client" });
    if (form.get("grant_type") === "authorization_code") {
      const granted = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!granted || granted.redirectUri !== form.get("redirect_uri") || granted.challenge !== challenge) {
        return json(response, 400, { error: "invalid_grant" });
      }
      return json(response, 200, tokensFor(granted.user, granted.nonce, granted.sessionId));
    }
    if (form.get("grant_type") === "refresh_token") {
      const renewed = refreshTokens.get(form.get("refresh_token"));
      refreshTokens.delete(form.get("refresh_token"));
      if (!renewed) return json(response, 400, { error: "invalid_grant" });
      return json(response, 200, tokensFor(renewed.user, renewed.nonce, renewed.sessionId));
    }
    return json(response, 400, { error: "unsupported_grant_type" });
  }

  const handle = (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    if (request.method === "OPTIONS") {
      cors(response);
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      return send(response, 204, "");
    }
    if (request.method === "GET" && url.pathname === `${base}/certs`) return json(response, 200, { keys: [jwk] });
    if (request.method === "GET" && url.pathname === `${base}/auth`) return authorize(request, response, url);
    if (request.method === "POST" && url.pathname === `${base}/token`) {
      return void token(request, response).catch(() => json(response, 500, { error: "server_error" }));
    }
    if (request.method === "GET" && url.pathname === `${base}/logout`) {
      const target = redirectTarget(url.searchParams.get("post_logout_redirect_uri"));
      const headers = { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` };
      if (!target) return send(response, 200, "signed out", headers);
      return send(response, 302, "", { Location: target.toString(), ...headers });
    }
    if (request.method === "GET" && url.pathname === `${base}/3p-cookies/step1.html`) {
      // keycloak-js asks whether a silent check can work. The realm and Studio are the same
      // site (localhost), so the session cookie does reach the hidden frame.
      return send(response, 200, '<!doctype html><script>parent.postMessage("supported", "*")</script>', {
        "Content-Type": "text/html; charset=utf-8",
      });
    }
    send(response, 404, "not found");
  };

  // `localhost` is 127.0.0.1 to some clients and ::1 to others, so both are served — and
  // nothing else: this signs in whoever is asked for.
  const servers = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createServer(handle);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      servers.push(server);
    } catch (cause) {
      // A machine without IPv6 has no ::1 to listen on; the port being taken is an error.
      if (host === "127.0.0.1" || cause?.code !== "EADDRNOTAVAIL") throw cause;
    }
  }

  function userOf(userId) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) throw new Error(`no such test user: ${userId}`);
    return user;
  }

  return {
    issuer,
    jwksUrl: `http://localhost:${port}${base}/certs`,
    /** A token as Builder would be sent it, for a check that needs no browser. */
    accessTokenFor(userId) {
      return tokensFor(userOf(userId), null, randomUUID()).access_token;
    },
    /**
     * Tokens a Builder that verifies must refuse, for the check that it does: one with
     * every claim right and a signature by a key the realm does not publish, and one the
     * realm signed for another audience.
     */
    tokensToRefuse(userId) {
      const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
      return {
        signedByAnotherKey: tokensFor(userOf(userId), null, randomUUID(), { signingKey: stranger }).access_token,
        forAnotherAudience: tokensFor(userOf(userId), null, randomUUID(), { tokenAudience: `${audience}-other` }).access_token,
      };
    },
    close: () =>
      Promise.all(
        servers.map(
          (server) =>
            new Promise((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections();
            }),
        ),
      ),
  };
}
