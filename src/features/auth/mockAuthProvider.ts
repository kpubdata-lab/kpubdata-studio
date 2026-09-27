/**
 * Mock/demo {@link AuthProvider} implementation (#263).
 *
 * Real IdP integration deferred post-Builder #515 — this provider is just a deterministic mock
 * to demonstrate Login/Signup UI and generic AuthProvider boundary, doesn't validate real credentials.
 * Never sends requests to Builder (forbid plaintext password, #263); mock token created here doesn't
 * wire to `apiFetch` auth header provider — this token never reaches actual Builder calls (Bearer
 * token wiring is Builder's responsibility post-#515 with real provider).
 *
 * Password exists only as function argument then discarded — never stored in store/localStorage/sessionStorage/logs.
 */
import { i18n } from "@/shared/i18n";
import { AuthError, type AuthProvider, type AuthSession, type SignInInput, type SignUpInput } from "./types";

function fabricateMockToken(): string {
  return `mock-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Deterministic rule just to demo "failure message" UI path in mock mode — not real credential
 * validation; this provider never stores or checks password anywhere.
 * (Try short password to see failure state.)
 */
function looksLikeDemoValidPassword(password: string): boolean {
  return password.length >= 4;
}

export const mockAuthProvider: AuthProvider = {
  id: "mock",

  async signIn({ email, password }: SignInInput): Promise<AuthSession> {
    if (!looksLikeDemoValidPassword(password)) {
      throw new AuthError(i18n.t("auth.mock.badCredentials"));
    }
    return {
      token: fabricateMockToken(),
      email,
      name: null,
      provider: "mock",
    };
  },

  async signUp(input: SignUpInput): Promise<AuthSession> {
    return {
      token: fabricateMockToken(),
      email: input.email,
      name: input.name,
      provider: "mock",
    };
  },

  async signOut(): Promise<void> {
    // Mock mode has no server session to discard — caller (useAuthStore.clear()) clears memory state.
  },
};
