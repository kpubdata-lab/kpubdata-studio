/**
 * Generic auth contract (#263).
 *
 * Provider-agnostic types to make providers swappable. Real auth is handled by ADR 0015
 * (Keycloak, Authorization Code + PKCE) in `keycloak.ts` (doesn't implement this contract) —
 * this contract is used by mock/demo providers.
 */

/** Tag indicating which provider created this session. */
export type AuthProviderId = "mock" | "keycloak";

/**
 * Session info Studio holds after successful login.
 *
 * Password is NEVER in this shape — no provider should store plaintext password
 * in session (#263 security requirement: no password in store/localStorage/sessionStorage/logs).
 */
export interface AuthSession {
  /** Bearer token for Builder calls (or mock token in mock mode). */
  token: string;
  email: string;
  /** Display name. null if provider doesn't provide name (#191 topbar avatar compatibility). */
  name: string | null;
  provider: AuthProviderId;
}

export interface SignInInput {
  email: string;
  password: string;
}

export type AccountType = "individual" | "organization";

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  accountType: AccountType;
  /** Only meaningful for team/organization (accountType === "organization"). */
  organizationName?: string;
}

/** Dedicated error type to distinguish login/signup failure from other exceptions (network errors, etc.). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Generic contract for provider performing email/password auth.
 *
 * Real Keycloak doesn't implement this — it redirects to hosted login page, not direct
 * `signIn(email, password)` calls (see `keycloak.ts`). Both paths merge at session model layer —
 * topbar avatar/Settings/LoginGate work identically regardless of provider.
 */
export interface AuthProvider {
  readonly id: AuthProviderId;
  signIn(input: SignInInput): Promise<AuthSession>;
  signUp(input: SignUpInput): Promise<AuthSession>;
  signOut(): Promise<void>;
}
