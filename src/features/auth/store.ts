/**
 * Authentication state management (expanded to a generic session in S3/#188, #263).
 *
 * Tokens are stored only in memory (the zustand store) — do not use persistence middleware.
 * Writing tokens to localStorage/sessionStorage allows a single XSS to steal them.
 * Session restoration on refresh is handled by Keycloak silent SSO (`initKeycloak`).
 *
 * Mock/email login (`setSession`) and OIDC session (`setOidcIdentity`) share this store
 * so UI elements like the topbar avatar (#191) and Settings/LoginGate (#190) behave the
 * same regardless of which provider authenticated the user.
 */
import { create } from "zustand";
import type { AuthProviderId, AuthSession } from "./types";

/**
 * OIDC (Keycloak) bootstrap status.
 *
 * Remains "disabled" in mock/demo or dev bypass environments — in that case LoginGate
 * follows existing mock-token policies.
 */
export type OidcStatus =
  | "disabled"
  | "initializing"
  | "authenticated"
  | "unauthenticated"
  | "error";

interface AuthState {
  /**
   * Bearer token sent to the Builder (mock session token). Null means unauthenticated.
   *
   * The OIDC (Keycloak) access token is not stored here — the keycloak-js in-memory
   * session is the authoritative source and any store copy becomes stale after refresh.
   * Builder requests obtain the latest token via `getFreshToken()` in `keycloak.ts`.
   */
  token: string | null;
  /** Logged-in user's email (for UI display, S6/#191). */
  email: string | null;
  /** Display name. Null if the provider does not provide a name (#263). */
  name: string | null;
  userId: string | null;
  /** The provider that created this session. Null when not logged in (#263). */
  providerId: AuthProviderId | null;
  /** OIDC bootstrap status. In mock/demo this is "disabled". */
  oidcStatus: OidcStatus;
  /** Store the generic {@link AuthProvider} (mock/#263) session as-is. */
  setSession: (session: AuthSession) => void;
  /**
   * Store only the display identity found in the Keycloak session. Do not store the raw access token
   * in the store (see the `token` comment above).
   */
  setOidcIdentity: (identity: { email: string | null; name: string | null; userId: string | null }) => void;
  /** Transition the OIDC bootstrap status. */
  setOidcStatus: (status: OidcStatus) => void;
  /** Logout — fully clear the session (OIDC bootstrap status is managed separately by callers). */
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  email: null,
  name: null,
  userId: null,
  providerId: null,
  oidcStatus: "disabled",
  setSession: (session) =>
    set({
      token: session.token,
      email: session.email,
      name: session.name,
      userId: null,
      providerId: session.provider,
    }),
  setOidcIdentity: ({ email, name, userId }) =>
    set({ token: null, email, name, userId, providerId: "keycloak" }),
  setOidcStatus: (oidcStatus) => set({ oidcStatus }),
  clear: () => set({ token: null, email: null, name: null, userId: null, providerId: null }),
}));
