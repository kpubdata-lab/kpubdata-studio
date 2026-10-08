/**
 * Studio internationalization (i18n) initialization — based on i18next + react-i18next.
 *
 * Policy:
 * - Default/fallback language is `ko` — new visitors & e2e env (navigator=en-US) deterministically ko.
 * - Language detection uses localStorage (`studio-lang`) only: prevents unexpected English
 *   switch via navigator auto-detect in Korea-first product (including e2e).
 *   User switcher selection always takes precedence.
 * - Translation keys organized by screen/module namespace prefix (e.g. `nav.*`, `header.*`).
 * - Unapplied Korean strings from unextracted screens fall back to ko as-is —
 *   measure incremental migration progress via `npm run i18n:coverage`.
 *
 * Loading (#796): each locale file is its own chunk, fetched when its language is needed —
 * a Korean visitor never downloads the English file, nor an English one the Korean file.
 * `main.tsx` renders once `i18nReady` settles, so the first paint is already translated.
 * English has no fallback language: `npm run i18n:keys` keeps ko and en on the same set of
 * keys, so a fallback would only download the Korean file for nothing. If the English file
 * cannot be fetched, Studio stays in (or falls back to) Korean rather than showing keys.
 */
import i18n, { type ResourceKey } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LANGUAGES = ["ko", "en"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const LANGUAGE_STORAGE_KEY = "studio-lang";

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  ko: "한국어",
  en: "English",
};

/** One dynamic import per language: Vite emits each locale as a separate chunk. */
const LOCALE_LOADERS: Record<AppLanguage, () => Promise<{ default: ResourceKey }>> = {
  ko: () => import("./locales/ko.json"),
  en: () => import("./locales/en.json"),
};

/** Normalizes to ko if current language is not in the supported list. */
export function normalizeLanguage(candidate: string | undefined): AppLanguage {
  return SUPPORTED_LANGUAGES.includes(candidate as AppLanguage)
    ? (candidate as AppLanguage)
    : "ko";
}

/**
 * Puts a language's resources in place, fetching its chunk the first time. Resolves
 * `false` when the chunk cannot be fetched. Browsers remember a failed `import()` of a
 * module for the life of the page, so trying again needs a reload.
 */
export async function loadLanguage(lang: AppLanguage): Promise<boolean> {
  if (i18n.hasResourceBundle(lang, "translation")) return true;
  try {
    const resources = await LOCALE_LOADERS[lang]();
    i18n.addResourceBundle(lang, "translation", resources.default);
    return true;
  } catch {
    return false;
  }
}

/**
 * The page says which language it is in (#841). `index.html` says Korean, the language
 * Studio starts in; this keeps `<html lang>` true when the reader's stored choice, or the
 * switcher, makes it English. A screen reader picks its voice by it, and a browser its
 * offer to translate.
 */
function syncDocumentLanguage(language: string | undefined): void {
  if (typeof document !== "undefined") document.documentElement.lang = normalizeLanguage(language?.split("-")[0]);
}

// Before `init`: with no resources to load it finishes at once, and a listener added
// after it has already missed the language the detector found.
i18n.on("languageChanged", syncDocumentLanguage);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Resources arrive from the locale chunks (loadLanguage), not with the entry chunk.
    resources: {},
    // English carries every key (i18n:keys gate), so it does not also need Korean.
    fallbackLng: { en: [], default: ["ko"] },
    // Detection: localStorage only — falls back to ko if missing. Switcher selection always takes precedence.
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false }, // React already escapes it.
    returnNull: false,
  });

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLanguage(value: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // Storage blocked: nothing was stored to keep.
  }
}

/**
 * Resolves once the detected language's resources are in place — or Korean's, when that
 * language's chunk could not be fetched. Never rejects: if even Korean cannot be fetched
 * the app still renders (with keys) rather than a blank page.
 */
export const i18nReady: Promise<void> = (async () => {
  // A stored "en-US" is English, as the resource lookup reads it.
  const detected = normalizeLanguage(i18n.language?.split("-")[0]);
  if (await loadLanguage(detected)) {
    if (i18n.language !== detected) await i18n.changeLanguage(detected);
  } else {
    // Shown in Korean this time, but the stored choice is the visitor's: changeLanguage
    // would overwrite it, so the next visit would not try their language again.
    const stored = readStoredLanguage();
    await loadLanguage("ko");
    await i18n.changeLanguage("ko");
    if (stored !== null) writeStoredLanguage(stored);
  }
  // The language the first paint is in, said once more here: a language found by the
  // detector and already loaded changes nothing above, and so tells no listener (#841).
  syncDocumentLanguage(i18n.language);
})();

/**
 * Changes language once its resources are loaded, and saves it to the detection cache
 * (localStorage). Resolves `false` and keeps the current language when the language's
 * chunk cannot be fetched (offline, or a deploy removed the old chunk) — switching anyway
 * would show raw keys.
 */
export async function changeLanguage(lang: AppLanguage): Promise<boolean> {
  if (!(await loadLanguage(lang))) return false;
  await i18n.changeLanguage(lang);
  return true;
}

export { i18n };
