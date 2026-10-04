/**
 * Per-user localStorage namespace (#293, #731).
 *
 * Same browser used by multiple people — locally saved BuildSpec/Report/drafts are
 * also separated by logged-in user. Unauthenticated sessions use existing (unowned) key —
 * demo data policy: items created before login stay in anonymous bucket, no migration (#293).
 *
 * An OIDC session is owned by its issuer and subject, the pair Builder owns data by: an
 * e-mail can change, and the same e-mail can exist at another issuer, so keying by it
 * showed one person's browser data to another (#731). What the user saved under the
 * e-mail key before is moved once, at sign-in ({@link migrateEmailOwnedStorage}).
 *
 * A mock or e-mail session has no subject and keeps the e-mail key (trim + lowercase).
 */
import { useAuthStore } from "./store";

const ANONYMOUS_OWNER = "anonymous";

function emailOwnerKey(email: string | null): string | null {
  if (!email || !email.trim()) return null;
  return `user:${email.trim().toLowerCase()}`;
}

/** Storage owner key for logged-in user. "anonymous" if not logged in. */
export function resolveStorageOwnerKey(): string {
  const { email, userId, issuer } = useAuthStore.getState();
  if (userId && issuer) return `sub:${issuer}#${userId}`;
  return emailOwnerKey(email) ?? ANONYMOUS_OWNER;
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

/**
 * Move what the signed-in OIDC user saved under their e-mail key to their issuer+subject
 * key (#731). Every key ending in `:user:<e-mail>` is moved, whatever feature wrote it.
 *
 * An entry already present under the new key wins and the old one is left where it is:
 * overwriting would lose the newer data, and merging is each feature's own business.
 * Returns how many entries were moved. Safe to call on every sign-in.
 */
export function migrateEmailOwnedStorage(): number {
  const { email, userId, issuer } = useAuthStore.getState();
  const oldOwner = emailOwnerKey(email);
  if (!userId || !issuer || !oldOwner) return 0;
  const newOwner = resolveStorageOwnerKey();
  const suffix = `:${oldOwner}`;
  let moved = 0;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && key.endsWith(suffix)) keys.push(key);
    }
    for (const key of keys) {
      const target = `${key.slice(0, -suffix.length)}:${newOwner}`;
      if (localStorage.getItem(target) !== null) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      localStorage.setItem(target, value);
      localStorage.removeItem(key);
      moved++;
    }
  } catch {
    // Storage unavailable or full: the e-mail entries stay, and nothing is lost.
  }
  return moved;
}
