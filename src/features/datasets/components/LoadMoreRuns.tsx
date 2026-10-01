/**
 * The footer of a run history list: how far it reaches and "show more" (#653).
 *
 * Builder sends no total, so the list never claims one: it says how many runs it holds
 * and the limit they were asked with, and offers more only while a page came back full.
 */
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui";

import { nextRunHistoryLimit, type LoadMoreStatus } from "../runHistory";

export function LoadMoreRuns({
  count,
  limit,
  status,
  error,
  canLoadMore,
  onLoadMore,
}: {
  count: number;
  limit: number;
  status: LoadMoreStatus;
  error?: string;
  canLoadMore: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const next = nextRunHistoryLimit(limit);
  return (
    <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
      <p>{canLoadMore ? t("runHistory.scopeMore", { count, limit }) : t("runHistory.scopeAll", { count })}</p>
      {status === "error" ? (
        <p className="text-status-failure" role="alert">
          {t("runHistory.moreFailed", { limit: next })}
          {error ? ` (${error})` : null}
        </p>
      ) : null}
      {canLoadMore ? (
        <div>
          <Button loading={status === "loading"} size="sm" variant="secondary" onClick={onLoadMore}>
            {t("runHistory.loadMore", { limit: next })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
