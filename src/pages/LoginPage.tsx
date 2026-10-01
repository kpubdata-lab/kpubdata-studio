/**
 * Login screen (/login, #263; added as real Keycloak login entry point in OIDC integration).
 *
 * Real IdP: kpubdata-builder ADR 0015 confirmed self-hosted Keycloak + Authorization Code +
 * PKCE (S256). This screen branches by environment:
 * - Mock/demo environment (`!isRealBuilderEnabled()`): keep existing mockAuthProvider email/password
 *   form (dev/demo only).
 * - Real connection + OIDC enabled: provide only Keycloak login redirect button. Email/password,
 *   password reset, email verification are all Keycloak's responsibility, so Studio has no input form.
 * - Real connection + OIDC not configured/error: display guidance only — don't fabricate fake redirect/token flow.
 *
 * Google login delegates to Keycloak identity broker (`keycloakLogin(returnTo, "google")`) —
 * Studio never loads Google SDK directly or sends Google tokens to Builder.
 */
import { Trans, useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { keycloakLogin } from "@/features/auth/keycloak";
import { getSafeReturnTo } from "@/features/auth/returnTo";
import { mockAuthProvider } from "@/features/auth/mockAuthProvider";
import { useAuthStore } from "@/features/auth/store";
import { AuthError } from "@/features/auth/types";
import { getOidcConfig } from "@/shared/config/env";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import { BrandLogo, Button, Card, DemoBadge, ErrorMessage, FormField, TextInput } from "@/shared/ui";

/**
 * Brief product introduction shown on auth screen. Brand v2 (#628 §19): a light neutral
 * panel by default, like the sidebar; the dark logo appears only under the dark theme.
 */
function BrandPanel() {
  const { t } = useTranslation();
  return (
    <section className="hidden min-h-screen flex-col border-r border-sidebar-border bg-sidebar px-8 py-10 text-sidebar-foreground lg:flex lg:w-[48%] lg:px-12 xl:px-16" aria-label={t("auth.page.introLabel")}>
      <div className="self-start">
        <BrandLogo className="w-[160px] xl:w-[192px]" />
      </div>
      <div className="my-auto max-w-xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-sidebar-muted">{t("auth.page.tagline")}</p>
        <h1 className="mt-5 max-w-xl break-keep text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground xl:text-5xl">
          {t("auth.page.introTitle")}
        </h1>
        <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
          {t("auth.page.introDesc")}
        </p>
        <div aria-hidden="true" className="mt-8 flex flex-wrap gap-2">
          {["Source", "BuildSpec", "Preview", "Validate", "Build", "Quality", "AI"].map((item) => (
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-sidebar-foreground" key={item}>{item}</span>
          ))}
        </div>
      </div>
      <p className="text-xs text-sidebar-muted">© 2026 KPubData Studio</p>
    </section>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);
  const oidcStatus = useAuthStore((state) => state.oidcStatus);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const session = await mockAuthProvider.signIn({ email, password });
      setSession(session);
      navigate(returnTo, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof AuthError ? cause.message : i18n.t("auth.page.loginFail"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const demoMode = !isRealBuilderEnabled();
  const oidc = getOidcConfig();
  const returnTo = getSafeReturnTo(new URLSearchParams(location.search).get("returnTo"));

    // If Keycloak session already confirmed, return to app (don't stay on login screen).
  useEffect(() => {
    if (!demoMode && oidcStatus === "authenticated") {
      navigate(returnTo, { replace: true });
    }
  }, [demoMode, oidcStatus, navigate, returnTo]);

  return (
    <main className="min-h-screen bg-background lg:flex">
      <BrandPanel />
      <section className="flex min-h-screen flex-1 items-center justify-center px-5 py-12 sm:px-8 lg:px-12" aria-label={t("auth.page.loginLabel")}>
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandLogo className="w-[160px] max-w-full" />
          </div>
          <div className="mb-7">
            <p className="text-xs font-semibold tracking-[0.16em] text-accent-subtle-foreground">{t("auth.page.eyebrow")}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t("auth.page.welcome")}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("auth.page.welcomeDesc")}</p>
          </div>
          <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{t("auth.page.loginTitle")}</h2>
            {demoMode ? <DemoBadge /> : null}
          </div>

          {demoMode ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("auth.page.mockNote")}
              </p>

              <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
                <FormField id="login-email" label={t("auth.page.email")} required>
                  {(field) => (
                    <TextInput
                      {...field}
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  )}
                </FormField>

                <FormField id="login-password" label={t("auth.page.password")} required>
                  {(field) => (
                    <TextInput
                      {...field}
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  )}
                </FormField>

                <ErrorMessage>{error}</ErrorMessage>

                <Button type="submit" loading={isSubmitting} className="mt-2">
                  {t("auth.page.submit")}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {t("auth.page.noAccount")}{" "}
                <Link to="/signup" className="font-medium text-accent-subtle-foreground underline">
                  {t("auth.page.getAccount")}
                </Link>
              </p>
            </>
          ) : oidcStatus === "initializing" ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("auth.page.checking")}</p>
          ) : oidcStatus === "error" ? (
            <ErrorMessage>{t("auth.page.initFail")}</ErrorMessage>
          ) : oidc.status === "ok" ? (
            <div className="mt-4 flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {t("auth.page.keycloak")}
              </p>
              <Button
                type="button"
                leadingIcon={<span aria-hidden="true" className="font-semibold">G</span>}
                onClick={() => void keycloakLogin(returnTo, "google")}
              >
                {t("auth.page.google")}
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                {t("auth.page.or")}
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="secondary" onClick={() => void keycloakLogin(returnTo)}>
                {t("auth.page.emailLogin")}
              </Button>
            </div>
          ) : oidc.status === "error" ? (
            <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("auth.oidc.errorTitle")}</p>
              <p className="mt-2">
                <Trans
                  i18nKey="auth.oidc.errorDesc"
                  components={{ code: <code /> }}
                />
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("auth.oidc.missingTitle")}</p>
              <p className="mt-2">
                {t("auth.oidc.missingDesc")}
              </p>
            </div>
          )}
          </Card>
        </div>
      </section>
    </main>
  );
}
