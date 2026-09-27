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
 */
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import ko from "./locales/ko.json";

export const SUPPORTED_LANGUAGES = ["ko", "en"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const LANGUAGE_STORAGE_KEY = "studio-lang";

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  ko: "한국어",
  en: "English",
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
    },
    fallbackLng: "ko",
    // Detection: localStorage only — falls back to ko if missing. Switcher selection always takes precedence.
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false }, // React already escapes it.
    returnNull: false,
  });

/** Normalizes to ko if current language is not in the supported list. */
export function normalizeLanguage(candidate: string | undefined): AppLanguage {
  return SUPPORTED_LANGUAGES.includes(candidate as AppLanguage)
    ? (candidate as AppLanguage)
    : "ko";
}

/** Changes language and saves to detection cache (localStorage). */
export function changeLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
}

export { i18n };
