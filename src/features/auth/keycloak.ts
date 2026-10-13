/**
 * Keycloak OIDC client singleton (ADR 0015).
 *
 * Public SPA + Authorization Code Flow + PKCE (S256), no client secret.
 * Access/refresh tokens live only in the keycloak-js in-memory session — the Studio
 * never stores raw tokens in localStorage/sessionStorage/DOM/logs.
 *
 * We do not reimplement the OAuth protocol. Redirect/callback/PKCE/refresh are all
 * handled by keycloak-js; this module simply wraps it to ensure a single global
 * instance is used across the app.
 */
import { i18n } from "@/shared/i18n";
import Keycloak, { type KeycloakInitOptions } from "keycloak-js";
import { getOidcConfig } from "@/shared/config/env";
import { getStudioUrl } from "./returnTo";

/** If the remaining token lifetime before a Builder request is shorter than this, refresh it (seconds). */
const TOKEN_MIN_VALIDITY_SECONDS = 30;

/**
 * Waits before each retry of a refresh the identity provider did not answer (#983). Two
 * retries over about two seconds: an outage longer than that is reported, not waited out.
 */
const REFRESH_RETRY_DELAYS_MS = [500, 1500] as const;
/**
 * After a refresh found the identity provider unreachable, how long it is not asked again
 * with retries (#983). A forced refresh in this window answers `unavailable` at once, and a
 * regular one makes a single attempt: otherwise every request on a screen, each refused in
 * turn, would start its own series and the retries would be bounded per request, not per
 * outage.
 */
const UNREACHABLE_COOLDOWN_MS = 5_000;
/** keycloak-js sets no timeout on the token request; one that hangs this long is unanswered (ms). */
const REFRESH_ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * How a refresh ended (#983).
 *
 * - `fresh`: a token valid for the next request.
 * - `ended`: the session is over — the refresh token was refused (400 `invalid_grant`, 401),
 *   keycloak-js ended the session, or there is none. Signing out is the answer.
 * - `unavailable`: the identity provider could not be asked — a network error, a timeout
 *   or a 5xx from the token endpoint. The session may well be valid; nothing is known
 *   either way, so there is no token to send and no reason to sign anyone out.
 */
export type RefreshOutcome =
  | { status: "fresh"; token: string }
  | { status: "ended" }
  | { status: "unavailable" };

let instance: Keycloak | null = null;
let initPromise: Promise<boolean> | null = null;
/** A refresh that renews only a token close to expiry, while it is out. */
let refreshPromise: Promise<RefreshOutcome> | null = null;
/** A refresh that renews whatever the token's remaining lifetime, from the moment it is asked for. */
let forcedRefreshPromise: Promise<RefreshOutcome> | null = null;
/** Until when a refresh does not retry, after one found the identity provider unreachable (epoch ms). */
let unreachableUntil = 0;

/**
 * Create the singleton Keycloak instance only when the configuration is valid.
 * If OIDC is disabled or in error state, throw an error (caller handles fail-closed).
 */
export function getKeycloak(): Keycloak {
  if (instance) return instance;

  const result = getOidcConfig();
  if (result.status !== "ok") {
    throw new Error(
      result.status === "error" ? result.reason : i18n.t("auth.oidc.disabled"),
    );
  }

  instance = new Keycloak({
    url: result.config.authServerUrl,
    realm: result.config.realm,
    clientId: result.config.clientId,
  });
  return instance;
}

/**
 * Run a check-sso to verify any existing session (no forced login — LoginGate controls UI).
 * Memoize so it runs only once; on failure do not retry initialization.
 */
export function initKeycloak(): Promise<boolean> {
  if (initPromise) return initPromise;

  const keycloak = getKeycloak();
  // Include the app base so static files resolve correctly on GitHub Pages subpath deployments.
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const options: KeycloakInitOptions = {
    onLoad: "check-sso",
    pkceMethod: "S256",
    // Verify the session quietly via a hidden iframe. Do not fall back to a full redirect on failure.
    silentCheckSsoRedirectUri: `${window.location.origin}${base}silent-check-sso.html`,
    // Disable login iframe polling because it can cause infinite rechecks under third-party cookie blocking.
    checkLoginIframe: false,
  };

  initPromise = keycloak.init(options);
  return initPromise;
}

/** A token request that got no answer within `REFRESH_ATTEMPT_TIMEOUT_MS`. */
class RefreshTimeoutError extends Error {}

/**
 * Whether a rejected `updateToken()` means the identity provider could not be asked, as
 * opposed to it refusing the session (#983). keycloak-js rejects with a `NetworkError`
 * carrying the token endpoint's response for a non-2xx answer, and with whatever `fetch`
 * threw (a `TypeError`) when there was no answer. A refusal (400, 401) is not transient,
 * and neither is anything this function does not recognise: when in doubt, fail closed.
 */
function isTransientRefreshFailure(cause: unknown): boolean {
  if (cause instanceof RefreshTimeoutError || cause instanceof TypeError) return true;
  const status = (cause as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" && (status >= 500 || status === 408 || status === 429);
}


function withAttemptTimeout<T>(attempt: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RefreshTimeoutError("token refresh timed out")), REFRESH_ATTEMPT_TIMEOUT_MS);
  });
  return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ask keycloak-js for a token valid for `minValidity` more seconds, retrying a failure to
 * reach the identity provider at most `REFRESH_RETRY_DELAYS_MS.length` times (#983), and
 * not at all within `UNREACHABLE_COOLDOWN_MS` of a refresh that gave up. A refusal is not
 * retried: the same refresh token gets the same answer.
 */
async function renew(keycloak: Keycloak, minValidity: number): Promise<RefreshOutcome> {
  const coolingDown = Date.now() < unreachableUntil;
  if (coolingDown && minValidity === -1) return { status: "unavailable" };
  const retryDelays = coolingDown ? [] : REFRESH_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    if (!keycloak.authenticated) return { status: "ended" };
    try {
      await withAttemptTimeout(keycloak.updateToken(minValidity));
      const token = keycloak.token;
      unreachableUntil = 0;
      return token ? { status: "fresh", token } : { status: "ended" };
    } catch (cause) {
      // keycloak-js ends the session itself when the refresh token is refused (400).
      if (!keycloak.authenticated || !isTransientRefreshFailure(cause)) return { status: "ended" };
      const wait = retryDelays[attempt];
      if (wait === undefined) {
        unreachableUntil = Date.now() + UNREACHABLE_COOLDOWN_MS;
        return { status: "unavailable" };
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Refresh an access token that is close to expiration and say how that went.
 *
 * When multiple Builder requests concurrently trigger a refresh, coalesce them
 * so the actual `updateToken` call happens only once. A failed refresh never yields
 * a token, so a stale one is not used; whether the failure ended the session or only
 * could not reach the identity provider is in the outcome (#983).
 *
 * `force` is asked for after Builder refused the token (401), and means "a token issued after
 * this moment" (#984). A regular refresh already out when it is asked may end without renewing
 * anything — the token it looked at was not close to expiry — so a forced one does not take that
 * answer: it waits for the regular one to end and then renews. Forced refreshes asked for
 * meanwhile share that one renewal, and so do regular ones, which a renewal satisfies. If the
 * regular refresh ended the session (the refresh token was refused), nothing more is sent.
 */
export async function refreshAccessToken(opts?: { force?: boolean }): Promise<RefreshOutcome> {
  const keycloak = instance;
  if (!keycloak?.authenticated) return { status: "ended" };

  if (forcedRefreshPromise) return forcedRefreshPromise;

  if (opts?.force) {
    const regular = refreshPromise;
    forcedRefreshPromise = (regular ?? Promise.resolve(null))
      .then(() => renew(keycloak, -1))
      .finally(() => {
        forcedRefreshPromise = null;
      });
    return forcedRefreshPromise;
  }

  refreshPromise ??= renew(keycloak, TOKEN_MIN_VALIDITY_SECONDS).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/** {@link refreshAccessToken}, reduced to the token: null whenever there is none to send. */
export async function getFreshToken(opts?: { force?: boolean }): Promise<string | null> {
  const outcome = await refreshAccessToken(opts);
  return outcome.status === "fresh" ? outcome.token : null;
}

/** Start a Keycloak login redirect that returns to the current origin. */
export function keycloakLogin(returnTo = "/", idpHint?: string): Promise<void> {
  const callback = `/login?${new URLSearchParams({ returnTo }).toString()}`;
  const options = { redirectUri: getStudioUrl(callback) };
  return getKeycloak().login(idpHint ? { ...options, idpHint } : options);
}

/** Logout of the Keycloak session and return to the current origin. */
export function keycloakLogout(): Promise<void> {
  // Preserve the app base path like login redirects do (supports subpath deployments).
  return getKeycloak().logout({ redirectUri: getStudioUrl("/") });
}

/** Test helper: reset the module singleton state. */
export function __resetKeycloakForTests(): void {
  instance = null;
  initPromise = null;
  refreshPromise = null;
  forcedRefreshPromise = null;
  unreachableUntil = 0;
}
