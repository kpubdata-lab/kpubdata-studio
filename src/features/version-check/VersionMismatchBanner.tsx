/**
 * One line telling the user Studio and Builder come from different releases (#430).
 *
 * It informs and never blocks: a patch difference must not make the product
 * unusable, and even a minor difference usually leaves most screens working.
 *
 * A Builder whose API contract is below `MIN_BUILDER_API_VERSION` is another matter
 * (#725): routes Studio calls do not exist there, so screens fail rather than degrade.
 * That is said as an alert on every page and cannot be dismissed — it still does not
 * replace the page, because the screens the older Builder does serve keep working.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { isBuilderApiCompatible, isRealBuilderEnabled, MIN_BUILDER_API_VERSION } from "@/shared/lib/builderApi";

import { ensureVersionChecked, useVersionCheckStore } from "./store";

export function VersionMismatchBanner() {
  const { t } = useTranslation();
  const comparison = useVersionCheckStore((s) => s.comparison);
  const apiVersion = useVersionCheckStore((s) => s.apiVersion);
  const dismissed = useVersionCheckStore((s) => s.dismissed);
  const dismiss = useVersionCheckStore((s) => s.dismiss);
  const realEnabled = isRealBuilderEnabled();

  const { pathname } = useLocation();

  // Asked on every navigation: a success is cached for the page load, and a failure is
  // not, so an Builder that was unreachable at first is checked when it comes back (#480).
  useEffect(() => {
    if (realEnabled) void ensureVersionChecked();
  }, [realEnabled, pathname]);

  if (!realEnabled) return null;

  if (apiVersion !== null && !isBuilderApiCompatible(apiVersion)) {
    return (
      <div
        className="border-b border-status-failure-border bg-status-failure-subtle px-4 py-2 text-sm text-status-failure"
        data-version-check="contract-too-old"
        role="alert"
      >
        {t("versionCheck.contractTooOld", { api: apiVersion, min: MIN_BUILDER_API_VERSION })}{" "}
        {t("versionCheck.contractRemedy")}
      </div>
    );
  }

  if (dismissed || comparison?.kind !== "mismatch") return null;

  return (
    <div
      className="flex items-start gap-3 border-b border-status-warning-border bg-status-warning-subtle px-4 py-2 text-sm text-status-warning"
      role="status"
    >
      <p className="flex-1">
        {t("versionCheck.mismatch", { studio: comparison.studio, builder: comparison.builder })}{" "}
        {t("versionCheck.remedy")}
      </p>
      <button
        aria-label={t("versionCheck.dismiss")}
        className="shrink-0 rounded px-2 hover:bg-status-warning-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={dismiss}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
