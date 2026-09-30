/**
 * Monitoring screen (`/monitoring`) — KPubData Builder health and the last 24 hours of
 * refreshes (#264, #302, #303, #539).
 *
 * One page, read top to bottom: Builder API, Queue, Workers and the Snapshot store as
 * key-value rows, then refresh counts for the window, then the recent refreshes. The
 * panels live in `features/monitoring/components/HealthPanels.tsx`; this file handles
 * state, polling and the "refresh every 30 seconds" option.
 *
 * Conforms to Builder #516 actual contract (#302):
 * - GET /monitoring/summary + GET /monitoring/builds?window=24h&bucket=hour parallel calls
 * - In real integration mode, errors are not masked as mock (prevents false success)
 * - 401/403 is one line saying the page needs permission, not an empty screen (#539).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PageHeader, Button, Skeleton } from "@/shared/ui";
import { ApiError, builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { MonitoringData, MonitoringLoadingState } from "@/features/monitoring/model";
import { getMockMonitoringData } from "@/features/monitoring/api/mockData";
import {
  BuilderHealthPanel,
  RecentRefreshesTable,
  RefreshStatsPanel,
} from "@/features/monitoring/components/HealthPanels";
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";

export function MonitoringPage() {
  const { t } = useTranslation();
  const autoRefreshId = useId();
  const [loading, setLoading] = useState<MonitoringLoadingState>("idle");
  const [unauthorized, setUnauthorized] = useState(false);
  const [data, setData] = useState<MonitoringData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousStatusRef = useRef<string | null>(null);

  const fetchMonitoringData = useCallback(async () => {
    if (!isPageVisible) return;

    setLoading("loading");

    if (!isRealBuilderEnabled()) {
      setData(getMockMonitoringData());
      setLoading("success");
      setLastRefreshTime(new Date());
      return;
    }

    try {
      const [summary, builds] = await Promise.all([
        builderApi.getMonitoringSummary(),
        builderApi.getMonitoringBuilds(),
      ]);
      setData({ summary, builds });
      setLoading("success");
      setLastRefreshTime(new Date());

      if (
        previousStatusRef.current &&
        previousStatusRef.current !== summary.status
      ) {
        if (summary.status === "degraded") {
          console.warn("Builder system health degraded");
        }
      }
      previousStatusRef.current = summary.status;
    } catch (err) {
       // 401/403 distinguished as authentication/authorization issue — based on real API response (#302).
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUnauthorized(true);
        setLoading("error");
        return;
      }
      setLoading("error");
    }
  }, [isPageVisible]);

  useEffect(() => {
    fetchMonitoringData();

    if (autoRefresh && isPageVisible) {
      intervalRef.current = setInterval(fetchMonitoringData, 30000);
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchMonitoringData, autoRefresh, isPageVisible]);

  useEffect(() => {
    const onVisibilityChange = () => setIsPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);


  const main = "flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10";

  if (unauthorized) {
    return (
      <main className={main}>
        <PageHeader title={t("monitoringPage.title")} />
        <p className="text-sm text-muted-foreground" role="status">
          <strong className="font-medium text-foreground">{t("monitoringPage.forbiddenTitle")}</strong> — {t("monitoringPage.forbidden")}
        </p>
      </main>
    );
  }

  return (
    <main className={main}>
      <PageHeader
        title={t("monitoringPage.title")}
        meta={
          lastRefreshTime
            ? t("monitoringPage.lastUpdate", {
                at: lastRefreshTime.toLocaleTimeString(
                  i18n.language?.startsWith("en") ? "en-US" : "ko-KR",
                ),
              })
            : t("monitoringPage.loading")
        }
        description={t("monitoringPage.desc")}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-foreground" htmlFor={autoRefreshId}>
              <input
                checked={autoRefresh}
                className="h-4 w-4 accent-accent"
                id={autoRefreshId}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                type="checkbox"
              />
              {t("monitoringPage.autoRefresh")}
            </label>
            <Button variant="secondary" size="sm" onClick={() => fetchMonitoringData()} type="button">
              {t("monitoringPage.refresh")}
            </Button>
          </>
        }
      />

      {data?.summary.status === "degraded" ? (
        <p className="text-sm text-status-warning" role="status">
          {t("monitoringPage.degraded")}
        </p>
      ) : null}

      {loading === "error" ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("monitoring.error.title")} — {t("monitoring.error.retry")}
        </p>
      ) : !data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <BuilderHealthPanel summary={data.summary} />
          <RefreshStatsPanel builds={data.builds} />
          <RecentRefreshesTable runs={data.builds.recent_runs} />
        </>
      )}
    </main>
  );
}
