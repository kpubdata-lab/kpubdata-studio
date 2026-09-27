/**
 * Studio internationalization (i18n) initialization — based on i18next + react-i18next.
 *
 * Policy:
 * - 기본/폴백 언어는 `ko` — 신규 방문자·e2e 환경(navigator=en-US) 모두 결정적으로 ko.
 * - 언어 감지는 localStorage(`studio-lang`)만 사용한다: 한국어 우선 제품에서
 *   navigator 자동 감지로 인한 예기치 않은 영어 전환(e2e 포함)을 방지한다.
 *   사용자가 스위처로 고르면 그 선택이 항상 우선한다.
 * - 번역 키는 화면/도metadata)인별 네임스페이스 접두어로 정리한다(예: `nav.*`, `header.*`).
 * - 아직 추출되지 않은 화면의 한국어 문자열은 폴백(ko) 그대로 노출된다 —
 *   점진적 전환 진행 상황은 `npm run i18n:coverage`로 측정한다.
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
