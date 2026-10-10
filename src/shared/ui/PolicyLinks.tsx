/**
 * The deployment's privacy policy, terms of use and support contact (#838).
 *
 * `PolicyLinks` is the row under the login and sign-up cards. `SupportLine` is the one
 * sentence a screen adds where it tells the user to contact an administrator: without
 * it the user was told to ask someone and not told whom. Both render nothing when the
 * deployment set none of the values.
 */
import { useTranslation } from "react-i18next";

import { getPolicyLinks } from "@/shared/config/policyLinks";
import { getSupportContact } from "@/shared/lib/clientErrors";

import { cn } from "./cn";

const linkClassName = "font-medium text-brand-text underline underline-offset-2";

export interface PolicyLinksProps {
  className?: string;
}

export function PolicyLinks({ className }: PolicyLinksProps) {
  const { t } = useTranslation();
  const links = getPolicyLinks();
  const contact = getSupportContact();
  const items = [
    links.privacy ? { key: "privacy", href: links.privacy, label: t("policy.privacy") } : null,
    links.terms ? { key: "terms", href: links.terms, label: t("policy.terms") } : null,
    contact ? { key: "support", href: contact.href, label: t("policy.support") } : null,
  ].filter((item) => item !== null);
  if (items.length === 0) return null;
  return (
    <nav aria-label={t("policy.label")} className={cn("text-xs text-muted-foreground", className)}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.key}>
            <a className={linkClassName} href={item.href} rel="noopener noreferrer" target="_blank">
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface SupportLineProps {
  className?: string;
}

export function SupportLine({ className }: SupportLineProps) {
  const { t } = useTranslation();
  const contact = getSupportContact();
  if (!contact) return null;
  return (
    <p className={cn("text-sm leading-6 text-muted-foreground", className)} data-support-line="">
      {t("policy.supportLine")}{" "}
      <a className={linkClassName} href={contact.href} rel="noopener noreferrer" target="_blank">
        {contact.label}
      </a>
    </p>
  );
}
