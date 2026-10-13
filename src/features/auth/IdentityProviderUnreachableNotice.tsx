/**
 * One line saying the identity provider could not be reached when the token was last
 * refreshed (#983). It is a notice, not a sign-out: the identity and everything saved for
 * it stay, and it goes away by itself once a refresh succeeds.
 */
import { useTranslation } from "react-i18next";

import { useAuthStore } from "./store";

export function IdentityProviderUnreachableNotice() {
  const { t } = useTranslation();
  const unreachable = useAuthStore((state) => state.identityProviderUnreachable);
  if (!unreachable) return null;
  return (
    <div
      className="border-b border-status-warning-border bg-status-warning-subtle px-4 py-2 text-sm text-status-warning"
      data-auth-notice="idp-unreachable"
      role="status"
    >
      {t("auth.idpUnreachable")}
    </div>
  );
}
