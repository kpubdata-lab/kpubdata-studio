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

function ownerKeyOf(email: string | null, userId: string | null, issuer: string | null): string {
  if (userId && issuer) return `sub:${issuer}#${userId}`;
  return emailOwnerKey(email) ?? ANONYMOUS_OWNER;
}

/** Storage owner key for logged-in user. "anonymous" if not logged in. */
export function resolveStorageOwnerKey(): string {
  const { email, userId, issuer } = useAuthStore.getState();
  return ownerKeyOf(email, userId, issuer);
}

/**
 * The owner key, as a hook that re-renders when another account signs in (#902).
 *
 * Server state has no shared cache: each screen holds what it loaded. A screen puts this
 * key in the dependencies of the effect that loads, so a change of owner drops what it
 * holds and aborts what it still has in flight — one account's runs never show, and a
 * late answer never lands, under another's name.
 */
export function useStorageOwnerKey(): string {
  return useAuthStore((state) => ownerKeyOf(state.email, state.userId, state.issuer));
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
 * Nothing moves unless the token says the e-mail is verified (#750). The move is by
 * address and happens once: on a shared browser, an account that only claims an address
 * would otherwise take what the address's real owner saved, for good. Builder refuses
 * such a token too, but this runs before any request reaches it.
 *
 * An entry already present under the new key wins and the old one is left where it is:
 * overwriting would lose the newer data, and merging is each feature's own business.
 * Returns how many entries were moved. Safe to call on every sign-in.
 */
export function migrateEmailOwnedStorage(): number {
  const { email, userId, issuer, emailVerified } = useAuthStore.getState();
  const oldOwner = emailOwnerKey(email);
  if (!userId || !issuer || !oldOwner || !emailVerified) return 0;
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
