/**
 * One explanation in place of the page while Builder refuses the signed-in session (#771).
 *
 * The identity provider renews the token and Builder still answers 401. Every screen
 * showed its own "could not load", and every query kept renewing and resending. The shell
 * renders this instead of the route, with Builder's own reason, and nothing is resent
 * until the user asks.
 */
import { useTranslation } from "react-i18next";

import { clearSessionRefusal, type SessionRefusal } from "@/shared/lib/sessionRefusal";
import { Button, SupportLine } from "@/shared/ui";

export function SessionRefusedNotice({ refusal, onSignOut }: { refusal: SessionRefusal; onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center px-5 py-10 sm:px-8 lg:px-10" data-session-refused={refusal.code ?? ""}>
      <div className="w-full max-w-xl rounded-xl border border-status-failure-border bg-status-failure-subtle p-6" role="alert">
        <h1 className="text-xl font-semibold tracking-tight text-status-failure">{t("sessionRefused.title")}</h1>
        <p className="mt-3 text-sm leading-6 text-foreground">{t("sessionRefused.desc")}</p>
        {refusal.reason ? (
          <p className="mt-2 text-sm leading-6 text-foreground">
            {t("sessionRefused.reason")} <span className="font-mono text-xs">{refusal.reason}</span>
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {/* Builder names this cause by code since contract 1.95.0 (kpubdata-builder#1074);
              an older Builder, or any other cause, gets the general advice. */}
          {refusal.code === "email_not_verified" ? t("sessionRefused.nextEmail") : t("sessionRefused.next")}
        </p>
        <SupportLine className="mt-2" />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={clearSessionRefusal} variant="secondary">
            {t("sessionRefused.tryAgain")}
          </Button>
          <Button onClick={onSignOut} variant="secondary">
            {t("sessionRefused.signOut")}
          </Button>
        </div>
      </div>
    </div>
  );
}
