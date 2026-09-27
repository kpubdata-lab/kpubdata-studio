/**
 * Utilities to save/restore New Build drafts to browser localStorage (#10, #84).
 *
 * Temporarily store in-progress build drafts so users can refresh or reopen and
 * continue editing. When saving, wrap with an envelope {version, data, savedAt};
 * when restoring, validate the version and an optional zod schema and quietly
 * ignore or clean mismatches or corrupted values. Fall back to safe defaults
 * (null/false) when localStorage access fails (SSR/private mode, etc.).
 */
/** Default save key for the New Build Wizard. Other flows (Add Data, etc.) pass a different key (#250). */
import { ownedStorageKey } from "@/features/auth/storageOwner";

const DRAFT_KEY = "kpubdata-studio:new-build-draft";

/** Envelope schema version. Bump when an incompatible shape change occurs. */
export const DRAFT_VERSION = 1;

/** Structure of the draft envelope stored in localStorage. */
interface DraftEnvelope<T> {
  /** Envelope schema version */
  version: number;
  /** The actual draft data */
  data: T;
  /** ISO timestamp recorded when saved */
  savedAt: string;
}

/** Minimal validation interface that only relies on a zod schema's `safeParse`. */
interface DraftValidator<T> {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
}

/**
 * Save a draft value wrapped in a versioned envelope. Failures are silently ignored.
 *
 * @param value - A serializable draft value.
 */
export function saveDraft<T>(value: T, key: string = ownedStorageKey(DRAFT_KEY)): void {
  try {
    const envelope: DraftEnvelope<T> = {
      version: DRAFT_VERSION,
      data: value,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Ignore when localStorage is unavailable.
  }
}

/**
 * Load a saved draft. Returns null when absent or corrupted.
 *
 * If the envelope version differs from the current version, or if the data fails
 * schema validation (when a validator is provided), treat the value as
 * corrupted, remove it, and return null.
 *
 * @param validator - Optional zod schema to validate the data. If omitted, only the version is checked.
 * @param key - Optional draft storage key. Defaults to the New Build Wizard key.
 * @param sanitize - Optional policy to sanitize data immediately after restore (#206/S07).
 *   If the sanitized value differs from the original (e.g. older versions left plaintext
 *   credentials), the cleaned value is saved back immediately and returned — raw secrets
 *   are not returned in-memory. Non-secret drafts avoid unnecessary rewrite via deep equality.
 * @returns The stored draft value or null.
 */
export function loadDraft<T>(
  validator?: DraftValidator<T>,
  key: string = ownedStorageKey(DRAFT_KEY),
  sanitize?: (data: T) => T,
): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as DraftEnvelope<unknown>).version !== DRAFT_VERSION
    ) {
      // Version mismatch or not an envelope: proactively clear it.
      clearDraft(key);
      return null;
    }
    const data = (parsed as DraftEnvelope<unknown>).data;
    let value: T;
    if (validator) {
      const result = validator.safeParse(data);
      if (!result.success) {
        clearDraft(key);
        return null;
      }
      value = result.data;
    } else {
      value = data as T;
    }
    if (sanitize) {
      const cleaned = sanitize(value);
      if (JSON.stringify(cleaned) !== JSON.stringify(value)) {
        // Clean plaintext secrets left by older versions at read time and re-save
        // using the same save boundary policy.
        saveDraft(cleaned, key);
        return cleaned;
      }
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Remove a saved draft.
 *
 * @param key - Optional draft storage key. Defaults to the New Build Wizard key.
 */
export function clearDraft(key: string = ownedStorageKey(DRAFT_KEY)): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore.
  }
}

/**
 * Check whether a saved draft exists.
 *
 * @param key - Optional draft storage key. Defaults to the New Build Wizard key.
 * @returns Whether a draft exists.
 */
export function hasDraft(key: string = ownedStorageKey(DRAFT_KEY)): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
