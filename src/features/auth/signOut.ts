/**
 * Ending an OIDC session (#769).
 *
 * keycloak-js's `logout()` only navigates to the identity provider: it does not clear
 * its token or call `onAuthLogout` first (checked in keycloak-js 26.2.4 — the default
 * adapter's `logout` is `window.location.replace(createLogoutUrl(...))`). So nothing ran
 * before the page left, and what the user had saved in this browser — the assistant's
 * LLM key under `kpubdata-assist-key:<owner>` — stayed behind on a shared machine.
 *
 * This clears the session first, then leaves. Clearing the auth store is what the
 * assistant's saved key follows (`features/assistant/config` deletes the previous
 * owner's key when the signed-in user changes), so that module is loaded here: without
 * it nothing would be listening. Provider keys held in memory go with the same clear.
 *
 * The logout URL is built from keycloak-js's own id token, not from the store, so
 * clearing the store first does not weaken the sign-out at the identity provider.
 */
import "@/features/assistant/config";

import { useAuthStore } from "./store";

export async function signOutOfOidc(): Promise<void> {
  // Loaded on demand like the rest of the Keycloak code; the clear waits for it so that
  // nothing sits between clearing and leaving for a guard to redirect on.
  const { keycloakLogout } = await import("./keycloak");
  useAuthStore.getState().clear();
  return keycloakLogout();
}
