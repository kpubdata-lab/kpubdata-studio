/**
 * One explanation in place of the page while the sign-up ledger holds the user back (#658).
 *
 * Builder answers every authenticated request with 403 `signup_pending` (or
 * `signup_rejected`) until an administrator decides. Without this, every screen showed its
 * own generic "could not load" at once and nothing said why. The shell renders this
 * instead of the route, so no page repeats the error underneath it.
 */
import { useTranslation } from "react-i18next";

import { clearSignupBlock, type SignupBlock } from "@/shared/lib/signupStatus";
import { Button, SupportLine } from "@/shared/ui";
import { cn } from "@/shared/ui/cn";

const TONE: Record<SignupBlock, string> = {
  pending: "border-status-warning-border bg-status-warning-subtle",
  rejected: "border-status-failure-border bg-status-failure-subtle",
};

const TITLE_TONE: Record<SignupBlock, string> = {
  pending: "text-status-warning",
  rejected: "text-status-failure",
};

export function SignupStatusNotice({ block }: { block: SignupBlock }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center px-5 py-10 sm:px-8 lg:px-10" data-signup-block={block}>
      <div className={cn("w-full max-w-xl rounded-xl border p-6", TONE[block])} role={block === "rejected" ? "alert" : "status"}>
        <h1 className={cn("text-xl font-semibold tracking-tight", TITLE_TONE[block])}>{t(`signupStatus.${block}.title`)}</h1>
        <p className="mt-3 text-sm leading-6 text-foreground">{t(`signupStatus.${block}.desc`)}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(`signupStatus.${block}.next`)}</p>
        <SupportLine className="mt-2" />
        <div className="mt-5">
          <Button onClick={clearSignupBlock} variant="secondary">
            {t("signupStatus.checkAgain")}
          </Button>
        </div>
      </div>
    </div>
  );
}
