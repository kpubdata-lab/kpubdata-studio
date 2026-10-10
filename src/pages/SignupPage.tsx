/** Public signup handled by Keycloak hosted UI, not Studio. */
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { keycloakLogin } from "@/features/auth/keycloak";
import { getSafeReturnTo } from "@/features/auth/returnTo";
import { getOidcConfig } from "@/shared/config/env";
import { BrandLogo, Button, Card, PolicyLinks } from "@/shared/ui";

export function SignupPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const oidc = getOidcConfig();
  const returnTo = getSafeReturnTo(new URLSearchParams(location.search).get("returnTo"));

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md text-center">
        {/* Light logo by default, the dark one only under the dark theme (#628). */}
        <div className="mb-7 flex justify-center">
          <BrandLogo className="h-8 w-auto" />
        </div>
        <Card>
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.signup.title")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("auth.signup.desc")}
        </p>
        {oidc.status === "ok" ? (
          <Button className="mt-6" onClick={() => void keycloakLogin(returnTo)}>
            {t("auth.signup.cta")}
          </Button>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">{t("auth.signup.notReady")}</p>
        )}
        <Link to="/login" className="mt-6 inline-block font-medium text-brand-text underline">
          {t("auth.signup.backToLogin")}
        </Link>
        </Card>
        <PolicyLinks className="mt-6" />
      </div>
    </main>
  );
}
