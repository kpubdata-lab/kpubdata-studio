/**
 * Move a value stored under an old localStorage key to its new key, once (#479).
 *
 * A rename of a storage key is a data migration: without one, what people saved under
 * the old name is orphaned. The new key wins if both exist, unless `merge` combines
 * them; the old key is removed either way so this runs once. Storage errors are
 * swallowed — the caller then simply starts from what the new key holds.
 */
export function moveLegacyKey(
  oldKey: string,
  newKey: string,
  merge?: (oldValue: string, newValue: string) => string,
): void {
  try {
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue === null) return;
    const newValue = localStorage.getItem(newKey);
    if (newValue === null) localStorage.setItem(newKey, oldValue);
    else if (merge) localStorage.setItem(newKey, merge(oldValue, newValue));
    localStorage.removeItem(oldKey);
  } catch {
    // No storage, or quota: nothing to move.
  }
}
