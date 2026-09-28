/**
 * Assistant config state (#205, ST-A2).
 *
 * LLM API key **memory-only by default**. Unlike auth token, re-entering each session has high friction,
 * so provide explicit "save to this browser" opt-in with clear warning. Default: don't save.
 */
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

function _loadPersistedKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function savePersistedKey(key: string): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage access failure (SSR/private mode) ignored
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

// Load on startup only if opted in
if (typeof window !== "undefined") {
  try {
    const persisted = localStorage.getItem(STORAGE_KEY);
    if (persisted) {
      useAssistConfig.setState({
        apiKey: persisted,
        isConfigured: true,
        persistToStorage: true,
      });
    }
  } catch {
    // ignored
  }
}
