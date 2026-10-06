/**
 * Account menu at the right end of the topbar (#523).
 *
 * Language, theme, help and sign-out used to be spread over the topbar (a language
 * toggle), the sidebar (a theme select) and the Settings page (sign-out). They are
 * preferences of the person, not of the page, so they live behind the avatar. The menu
 * is a small non-modal popover: Escape or a click outside closes it and focus returns to
 * the avatar.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { signOutOfOidc } from "@/features/auth/signOut";
import { useAuthStore } from "@/features/auth/store";
import { useUIStore, type ThemeMode } from "@/shared/hooks/useUIStore";
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  changeLanguage,
  normalizeLanguage,
  type AppLanguage,
} from "@/shared/i18n";

/** Studio's user documentation (mkdocs `site_url`). */
export const HELP_URL = "https://kpubdata-lab.github.io/kpubdata-studio/docs/";

const THEMES: ThemeMode[] = ["system", "light", "dark"];

/**
 * Extract single initial for avatar from logged-in email.
 *
 * @param email - Logged-in user email (null if missing).
 * @returns Single character to display in avatar, "?" when not signed in.
 */
function avatarInitial(email: string | null): string {
  return email ? email.charAt(0).toUpperCase() : "?";
}

const fieldClassName =
  "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const itemClassName =
  "block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Avatar button and the account popover.
 *
 * @returns Account menu element.
 */
export function AccountMenu() {
  const { t, i18n } = useTranslation();
  const email = useAuthStore((state) => state.email);
  const oidcStatus = useAuthStore((state) => state.oidcStatus);
  const clearSession = useAuthStore((state) => state.clear);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const language = normalizeLanguage(i18n.language);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // An OIDC session has to end at the identity provider too; otherwise only the
  // in-memory session is cleared. Same rule as the Settings page's account card.
  function signOut() {
    setOpen(false);
    if (oidcStatus === "authenticated") {
      // Clears what this browser holds for the user before the page leaves (#769).
      void signOutOfOidc();
      return;
    }
    clearSession();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={email ? t("layout.account.openFor", { email }) : t("layout.account.open")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        title={email ?? t("layout.account.notSignedIn")}
        type="button"
      >
        {avatarInitial(email)}
      </button>

      {open ? (
        <div
          aria-label={t("layout.account.title")}
          className="absolute right-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 text-card-foreground shadow-lg"
          id={panelId}
          role="dialog"
        >
          <div className="border-b border-border px-2 pb-2">
            {email ? (
              <>
                <p className="text-xs text-muted-foreground">{t("layout.account.signedInAs")}</p>
                <p className="truncate text-sm font-medium" title={email}>{email}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("layout.account.notSignedIn")}</p>
            )}
          </div>

          <div className="space-y-2 border-b border-border px-2 py-2">
            <label className="block text-xs font-medium text-muted-foreground">
              {t("layout.account.language")}
              <select
                className={fieldClassName}
                onChange={(event) => changeLanguage(event.target.value as AppLanguage)}
                value={language}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{LANGUAGE_LABELS[lang]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              {t("layout.theme")}
              <select
                className={fieldClassName}
                onChange={(event) => setTheme(event.target.value as ThemeMode)}
                value={theme}
              >
                {THEMES.map((mode) => (
                  <option key={mode} value={mode}>{t(`layout.themeMode.${mode}`)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="pt-1">
            <Link className={itemClassName} onClick={() => setOpen(false)} to="/settings">
              {t("nav.settings")}
            </Link>
            <a className={itemClassName} href={HELP_URL} onClick={() => setOpen(false)} rel="noopener noreferrer" target="_blank">
              {t("layout.account.help")}
            </a>
            {email ? (
              <button className={itemClassName} onClick={signOut} type="button">
                {t("layout.account.signOut")}
              </button>
            ) : (
              <Link className={itemClassName} onClick={() => setOpen(false)} to="/login">
                {t("layout.account.signIn")}
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
