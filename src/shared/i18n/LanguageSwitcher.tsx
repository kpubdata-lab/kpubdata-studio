/**
 * Language switch toggle — Korean/English.
 *
 * Shows current language in button label and cycles through supported languages on click.
 * Selection is persisted in i18next localStorage cache and retained on revisit.
 */
import { useTranslation } from "react-i18next";

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  changeLanguage,
  normalizeLanguage,
  type AppLanguage,
} from "./index";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = normalizeLanguage(i18n.language);

  const next: AppLanguage =
    SUPPORTED_LANGUAGES[
      (SUPPORTED_LANGUAGES.indexOf(current) + 1) % SUPPORTED_LANGUAGES.length
    ];

  return (
    <button
      type="button"
      onClick={() => changeLanguage(next)}
      aria-label={t("languageSwitcher.switchTo", { language: LANGUAGE_LABELS[next] })}
      title={LANGUAGE_LABELS[next]}
      data-testid="language-switcher"
      data-current-language={current}
      className="rounded-md border border-base-300 px-2 py-1 text-xs text-base-600 transition-colors hover:bg-base-100 hover:text-base-900 dark:border-base-600 dark:text-base-300 dark:hover:bg-base-800"
    >
      {LANGUAGE_LABELS[current]}
    </button>
  );
}
