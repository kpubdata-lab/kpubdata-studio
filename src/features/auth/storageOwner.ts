/**
 * Per-user localStorage namespace (#293).
 *
 * Same browser used by multiple people — locally saved BuildSpec/Report/drafts are
 * also separated by logged-in user. Unauthenticated sessions use existing (unowned) key —
 * demo data policy: items created before login stay in anonymous bucket, no migration (#293).
 *
 * Owner determined by current mock auth email (normalized: trim+lowercase).
 * After ADR 0015 (builder #515) real IdP integration, replace here once with stable identifier
 * (OIDC sub-based owner) and entire storage key policy follows.
 */
import { useAuthStore } from "./store";

const ANONYMOUS_OWNER = "anonymous";

/** Storage owner key for logged-in user. "anonymous" if not logged in. */
export function resolveStorageOwnerKey(): string {
  const { email } = useAuthStore.getState();
  if (!email || !email.trim()) return ANONYMOUS_OWNER;
  return `user:${email.trim().toLowerCase()}`;
}

/** Whether logged in. Unauthenticated storage uses existing unowned key (backward compatible). */
export function isOwnedStorageSession(): boolean {
  return resolveStorageOwnerKey() !== ANONYMOUS_OWNER;
}

/**
 * Namespace storage key by owner.
 * If not logged in, return baseKey as-is (no data loss for existing data).
 */
export function ownedStorageKey(baseKey: string): string {
  if (!isOwnedStorageSession()) return baseKey;
  return `${baseKey}:${resolveStorageOwnerKey()}`;
}
