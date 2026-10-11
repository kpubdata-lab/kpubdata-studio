/**
 * Beta badge (#412): says the product is a beta, with one sentence on what that means.
 *
 * A real deployment shows it in the top bar and on the login card. The demo shows
 * `DemoBadge` in the same places instead.
 */
import { useTranslation } from "react-i18next";

import { cn } from "./cn";

export interface BetaBadgeProps {
  className?: string;
}

export function BetaBadge({ className }: BetaBadgeProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-brand-subtle px-2.5 py-0.5 text-xs font-semibold text-brand-text",
        className,
      )}
      data-testid="beta-badge"
      title={t("layout.betaDesc")}
    >
      {t("layout.beta")}
      <span className="sr-only">{t("layout.betaDesc")}</span>
    </span>
  );
}
