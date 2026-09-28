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

let instance: Keycloak | null = null;
let initPromise: Promise<boolean> | null = null;
let refreshPromise: Promise<string | null> | null = null;

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

/**
 * Refresh an access token that is close to expiration and return the latest value.
 *
 * When multiple Builder requests concurrently trigger a refresh, coalesce them
 * so the actual `updateToken` call happens only once. If refresh fails return
 * null so we do not continue using a stale token.
 */
export async function getFreshToken(opts?: { force?: boolean }): Promise<string | null> {
  const keycloak = instance;
  if (!keycloak?.authenticated) return null;

  if (!refreshPromise) {
    const minValidity = opts?.force ? -1 : TOKEN_MIN_VALIDITY_SECONDS;
    refreshPromise = keycloak
      .updateToken(minValidity)
      .then(() => keycloak.token ?? null)
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
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
}
