/**
 * Authentication initialization — connect the auth store as the token provider for
 * apiFetch (S1↔S3) and bootstrap the OIDC (Keycloak) session. Call once from the
 * app entry point (main.tsx).
 */
import { getOidcConfig, isOidcEnabled } from "@/shared/config/env";
import { setAuthErrorCallback, setAuthTokenProvider } from "@/shared/lib/builderApi";
import { getFreshToken, getKeycloak, initKeycloak } from "./keycloak";
import { migrateEmailOwnedStorage } from "./storageOwner";
import { useAuthStore } from "./store";

export function initAuth(): void {
  // Token provider used by the Builder request boundary (called per request).
  // - When OIDC is enabled: return the latest access token from Keycloak's
  //   in-memory session (refreshing if near expiry).
  // - Otherwise (mock/demo): return the token from the in-memory store. In mock
  //   mode null means unauthenticated requests.
  setAuthTokenProvider(() =>
    isOidcEnabled() ? getFreshToken() : useAuthStore.getState().token,
  );

  setAuthErrorCallback(async () => {
    if (isOidcEnabled()) {
      // Do not treat 401 as success. Try a single forced refresh; on failure mark
      // the user unauthenticated so LoginGate prompts for re-login (no infinite retry).
      // If refresh succeeds return true so builderApi retries the request once with
      // the new token — the user won't see an error caused by token expiry during a request.
      const token = await getFreshToken({ force: true });
      if (token) return true;
      const store = useAuthStore.getState();
      store.clear();
      store.setOidcStatus("unauthenticated");
      return false;
    }
    // Mock/demo/Google paths have no session to refresh — just clear the session and
    // do not retry.
    useAuthStore.getState().clear();
    return false;
  });

  bootstrapOidc();
}

/** Parse OIDC config and, if enabled, perform a check-sso to verify the session. */
function bootstrapOidc(): void {
  const config = getOidcConfig();
  const store = useAuthStore.getState();

  if (config.status === "disabled") {
    store.setOidcStatus("disabled");
    return;
  }

  if (config.status === "error") {
    // Fail-closed: do not assume the user is authenticated. Log only issuer/clientId (not secrets).
    console.error(`[auth] OIDC configuration error: ${config.reason}`);
    store.setOidcStatus("error");
    return;
  }

  store.setOidcStatus("initializing");
  initKeycloak()
    .then((authenticated) => {
      const keycloak = getKeycloak();
      syncIdentity(authenticated);

      keycloak.onAuthSuccess = () => syncIdentity(true);
      keycloak.onAuthRefreshSuccess = () => syncIdentity(true);
      keycloak.onAuthLogout = () => {
        const current = useAuthStore.getState();
        current.clear();
        current.setOidcStatus("unauthenticated");
      };
      keycloak.onTokenExpired = () => {
        void getFreshToken();
      };
    })
    .catch(() => {
      // Do not retry initialization (avoids infinite loops). The user remains in error state.
      useAuthStore.getState().setOidcStatus("error");
    });
}

/** Reflect Keycloak session state into the store's display identity/status. */
function syncIdentity(authenticated: boolean): void {
  const store = useAuthStore.getState();
  if (!authenticated) {
    store.setOidcStatus("unauthenticated");
    return;
  }

  const claims = getKeycloak().tokenParsed as
    | { sub?: string; iss?: string; email?: string; email_verified?: unknown; name?: string; preferred_username?: string }
    | undefined;
  store.setOidcIdentity({
    email: claims?.email ?? null,
    name: claims?.name ?? claims?.preferred_username ?? null,
    userId: claims?.sub ?? null,
    issuer: claims?.iss ?? null,
    // Only the literal `true` counts: a missing claim or a string is not a verified address.
    emailVerified: claims?.email_verified === true,
  });
  // What this user saved in this browser under their e-mail moves to their issuer+sub
  // (#731) — when the token says the address is theirs (#750).
  migrateEmailOwnedStorage();
  store.setOidcStatus("authenticated");
}
