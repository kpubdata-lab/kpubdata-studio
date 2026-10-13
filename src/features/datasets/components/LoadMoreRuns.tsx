/**
 * The footer of a run history list: how far it reaches and "show more" (#653).
 *
 * Builder sends no total, so the list never claims one: it says how many runs it holds
 * and the limit they were asked with, and offers more only while a page came back full.
 * At Builder's maximum limit it offers no more and says older runs may still exist.
 */
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui";

import { LIST_LIMIT_MAX } from "@/shared/lib/builderApi";

import { atRunHistoryMax, nextRunHistoryLimit, type LoadMoreStatus } from "../runHistory";

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
  const atMax = atRunHistoryMax(limit);
  const scope = !canLoadMore
    ? t("runHistory.scopeAll", { count })
    : atMax
      ? t("runHistory.scopeAtMax", { count, max: LIST_LIMIT_MAX })
      : t("runHistory.scopeMore", { count, limit });
  return (
    <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
      <p>{scope}</p>
      {status === "error" ? (
        <p className="text-status-failure" role="alert">
          {t("runHistory.moreFailed", { limit: next })}
          {error ? ` (${error})` : null}
        </p>
      ) : null}
      {canLoadMore && !atMax ? (
        <div>
          <Button loading={status === "loading"} size="sm" variant="secondary" onClick={onLoadMore}>
            {t("runHistory.loadMore", { limit: next })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
