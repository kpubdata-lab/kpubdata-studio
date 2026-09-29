/**
 * One line telling the user Studio and Builder come from different releases (#430).
 *
 * It informs and never blocks: a patch difference must not make the product
 * unusable, and even a minor difference usually leaves most screens working.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { isRealBuilderEnabled } from "@/shared/lib/builderApi";

import { ensureVersionChecked, useVersionCheckStore } from "./store";

export function VersionMismatchBanner() {
  const { t } = useTranslation();
  const comparison = useVersionCheckStore((s) => s.comparison);
  const dismissed = useVersionCheckStore((s) => s.dismissed);
  const dismiss = useVersionCheckStore((s) => s.dismiss);
  const realEnabled = isRealBuilderEnabled();

  const { pathname } = useLocation();

  // Asked on every navigation: a success is cached for the page load, and a failure is
  // not, so a Builder that was unreachable at first is checked when it comes back (#480).
  useEffect(() => {
    if (realEnabled) void ensureVersionChecked();
  }, [realEnabled, pathname]);

  if (!realEnabled || dismissed || comparison?.kind !== "mismatch") return null;

  return (
    <div
      className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      role="status"
    >
      <p className="flex-1">
        {t("versionCheck.mismatch", { studio: comparison.studio, builder: comparison.builder })}{" "}
        {t("versionCheck.remedy")}
      </p>
      <button
        aria-label={t("versionCheck.dismiss")}
        className="shrink-0 rounded px-2 hover:bg-amber-100 dark:hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={dismiss}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
