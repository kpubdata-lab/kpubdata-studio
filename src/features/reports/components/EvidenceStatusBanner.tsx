/**
 * Notifies saved Report's reference evidence status (CURRENT/STALE/ORPHAN/UNAVAILABLE) (#258 §8).
 *
 * Regardless of status, never delete saved Report content or auto-swap to latest run — this
 * banner announces status; only when STALE does it show "Create new Report" entry point.
 */
import { useTranslation } from "react-i18next";
import { Card } from "@/shared/ui";
import type { EvidenceStalenessResult } from "../staleness";

const COPY: Record<EvidenceStalenessResult["status"], { titleKey: string; tone: "default" | "warn" | "error" }> = {
  current: { titleKey: "current", tone: "default" },
  stale: { titleKey: "stale", tone: "warn" },
  orphan: { titleKey: "orphan", tone: "error" },
  unavailable: { titleKey: "unavailable", tone: "warn" },
};

const TONE_CLASS: Record<"default" | "warn" | "error", string> = {
  default: "border-border bg-card",
  warn: "border-status-warning-border bg-status-warning-subtle",
  error: "border-status-failure-border bg-status-failure-subtle",
};

export function EvidenceStatusBanner({
  result,
  loading,
  onRecheck,
  onCreateFromLatest,
}: {
  result: EvidenceStalenessResult | null;
  loading: boolean;
  onRecheck: () => void;
  onCreateFromLatest?: () => void;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
        <span>{t("reports.evidenceBanner.rechecking")}</span>
      </Card>
    );
  }
  if (!result) return null;

  const copy = COPY[result.status];
  return (
    <Card className={`flex flex-wrap items-center justify-between gap-3 border py-3 text-sm ${TONE_CLASS[copy.tone]}`}>
      <div>
        <p className="font-medium">{t(`reports.evidenceBanner.status.${copy.titleKey}`)}</p>
        {result.reason ? <p className="mt-0.5 text-xs text-muted-foreground">{result.reason}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRecheck}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {t("reports.evidenceBanner.recheck")}
        </button>
        {result.status === "stale" && onCreateFromLatest ? (
          <button
            type="button"
            onClick={onCreateFromLatest}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {t("reports.evidenceBanner.newFromLatest")}
          </button>
        ) : null}
      </div>
    </Card>
  );
}
