/**
 * Assistant config state (#205, ST-A2).
 *
 * LLM API key **memory-only by default**. Unlike auth token, re-entering each session has high friction,
 * so provide explicit "save to this browser" opt-in with clear warning. Default: don't save.
 *
 * **The key belongs to the signed-in user** (kpubdata#812). It used to be one value for the
 * browser: held in memory across sign-out, and saved under one storage key, so the next
 * person to use the browser sent requests with the previous person's key. Now:
 *
 * - a saved key is stored under the signed-in user's owner key (`ownedStorageKey`);
 * - when the signed-in user changes — sign-out, session expiry, another account — the key
 *   in memory is dropped, and the saved key of the user who left is deleted;
 * - the old browser-wide entry is deleted the first time anyone signs in, and is given to
 *   no one: there is no telling whose it was.
 *
 * Without sign-in (the demo, a single-user deployment) there is one user and the key is
 * the browser's, as before.
 */
import { ownedStorageKey, resolveStorageOwnerKey } from "@/features/auth/storageOwner";
import { useAuthStore } from "@/features/auth/store";
import { i18n } from "@/shared/i18n";
import { create } from "zustand";
import { checkLlmBaseUrl } from "./baseUrl";

const STORAGE_KEY = "kpubdata-assist-key";
const STORAGE_WARNING =
  i18n.t("assistant.config.persistWarning");

interface AssistConfigState {
  apiKey: string;
  model: string;
  baseUrl: string;
  persistToStorage: boolean;
  isConfigured: boolean;
  /** Whether safe to send actual requests with this config (#256 review §2 — HTTPS only). */
  baseUrlSafe: boolean;
  /** Reason to show user when not safe. */
  baseUrlError?: string;
  /** Normalized base URL for actual requests (default if empty input). */
  resolvedBaseUrl: string;
  /** Whether using default Provider address as-is — else UI shows warning. */
  isDefaultBaseUrl: boolean;
  setConfig: (config: { apiKey: string; model?: string; baseUrl?: string }) => void;
  enablePersistence: () => void;
  disablePersistence: () => void;
  clear: () => void;
}

function baseUrlFields(baseUrl: string) {
  const check = checkLlmBaseUrl(baseUrl);
  return {
    baseUrlSafe: check.safe,
    baseUrlError: check.reason,
    resolvedBaseUrl: check.resolvedUrl,
    isDefaultBaseUrl: check.isDefault,
  };
}

const ANONYMOUS_OWNER = "anonymous";

/** The storage key of `owner`'s saved key; the bare key when nobody is signed in. */
function storageKeyOf(owner: string): string {
  return owner === ANONYMOUS_OWNER ? STORAGE_KEY : `${STORAGE_KEY}:${owner}`;
}

function loadPersistedKey(): string {
  try {
    return localStorage.getItem(ownedStorageKey(STORAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}

function savePersistedKey(key: string): void {
  try {
    if (key) localStorage.setItem(ownedStorageKey(STORAGE_KEY), key);
    else localStorage.removeItem(ownedStorageKey(STORAGE_KEY));
  } catch {
    // localStorage access failure (SSR/private mode) ignored
  }
}

function removeStored(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignored
  }
}

export const useAssistConfig = create<AssistConfigState>((set, get) => ({
  apiKey: "",
  model: "",
  baseUrl: "",
  persistToStorage: false,
  isConfigured: false,
  ...baseUrlFields(""),
  setConfig: (config) => {
    const baseUrl = config.baseUrl ?? "";
    set({
      apiKey: config.apiKey,
      model: config.model ?? "",
      baseUrl,
      isConfigured: config.apiKey.length > 0,
      ...baseUrlFields(baseUrl),
    });
    if (get().persistToStorage) savePersistedKey(config.apiKey);
  },
  enablePersistence: () => {
    if (typeof window !== "undefined" && window.confirm(STORAGE_WARNING)) {
      set({ persistToStorage: true });
      savePersistedKey(get().apiKey);
    }
  },
  disablePersistence: () => {
    set({ persistToStorage: false });
    savePersistedKey("");
  },
  clear: () => {
    set({ apiKey: "", isConfigured: false });
    savePersistedKey("");
  },
}));

/** Take up the current user's saved key, if they opted in to saving one. */
function loadForCurrentOwner(): void {
  const persisted = loadPersistedKey();
  if (persisted) {
    useAssistConfig.setState({ apiKey: persisted, isConfigured: true, persistToStorage: true });
  }
}

/**
 * The signed-in user changed. What is in memory was the previous user's: drop it. If the
 * previous user was signed in, their saved key goes too — signing out is the end of it.
 * Someone signing in gets their own saved key and never the browser-wide one, which is
 * deleted.
 */
function onOwnerChanged(previous: string, next: string): void {
  if (previous !== ANONYMOUS_OWNER) removeStored(storageKeyOf(previous));
  useAssistConfig.setState({ apiKey: "", isConfigured: false, persistToStorage: false });
  if (next === ANONYMOUS_OWNER) return;
  removeStored(STORAGE_KEY);
  loadForCurrentOwner();
}

// Load on startup only if opted in, then follow the signed-in user.
if (typeof window !== "undefined") {
  loadForCurrentOwner();
  let owner = resolveStorageOwnerKey();
  useAuthStore.subscribe(() => {
    const next = resolveStorageOwnerKey();
    if (next === owner) return;
    const previous = owner;
    owner = next;
    onOwnerChanged(previous, next);
  });
}
