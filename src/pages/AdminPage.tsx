/**
 * Administration (#409) — the live policy, every owner's runs (metadata only), and the
 * users of the Builder sign-up ledger with approval (kpubdata-builder#785).
 *
 * Reached from the menu only by an administrator, but the page does not rely on that:
 * each request is the Builder's decision, and a 403 is shown as "not an administrator"
 * rather than an empty page. Each card says its own state (#606): loading, loaded (an empty
 * list says it is empty), forbidden, unsupported (a 404 — a Builder without that route) or
 * failed, so one route failing never hides, or empties, another card. Nothing here carries a credential — the Builder's admin
 * responses are strict schemas without one, and an owner is an irreversible hash.
 *
 * **Refresh** (#661) reloads all three cards, the way Monitoring does. A card keeps what it
 * shows until its new answer arrives, so the users table — and a row whose approval is in
 * flight — stays mounted. A decision Builder returns while a refresh is in flight is laid
 * over that refresh's answer, which may have been read before the decision.
 *
 * **Run count** (#661, #702): `AdminRunsResponse.count` is the number of runs returned, not
 * a total — Builder sets it to `len(runs)` after cutting the list at `limit`. From contract
 * 1.73.0 Builder also sends `total`, the runs before that cut (kpubdata-builder#948), and the
 * card reads "N of M" and offers more only while `count < total`, up to the contract's
 * maximum `limit` of 200; past that it says how many older runs stay hidden. An older
 * Builder sends no total, so the card claims none: a full page reads "latest N (there may
 * be more)" and offers more up to 200.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import { UsersSection } from "@/features/admin/UsersSection";
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type AdminConfigResponse,
  type AdminRunsResponse,
  type AdminUser,
  type AdminUsersResponse,
} from "@/shared/lib/builderApi";
import { Button, Card, cn, PageHeader, Skeleton } from "@/shared/ui";

/** Runs asked for first, and the contract's maximum `limit` for `GET /admin/runs`. */
export const ADMIN_RUNS_PAGE = 50;
export const ADMIN_RUNS_MAX = 200;

type Load<T> =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: T };

function toLoad<T>(cause: unknown): Load<T> {
  if (cause instanceof ApiError && cause.status === 403) return { status: "forbidden" };
  // A Builder older than the sign-up ledger (contract 1.54) has no such route.
  if (cause instanceof ApiError && cause.status === 404) return { status: "unsupported" };
  return { status: "error", message: cause instanceof Error ? cause.message : String(cause) };
}

export function AdminPage() {
  const { t } = useTranslation();
  const real = isRealBuilderEnabled();
  const [config, setConfig] = useState<Load<AdminConfigResponse>>({ status: "loading" });
  const [runs, setRuns] = useState<Load<AdminRunsResponse>>({ status: "loading" });
  const [users, setUsers] = useState<Load<AdminUsersResponse>>({ status: "loading" });

  const [runsLimit, setRunsLimit] = useState(ADMIN_RUNS_PAGE);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Decisions Builder returned after the current users request was sent (see the header).
  const decidedSinceRequest = useRef(new Map<string, AdminUser>());

  const load = useCallback(
    (limit: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      decidedSinceRequest.current = new Map();
      const live = () => !controller.signal.aborted;
      setRefreshing(true);
      const config = builderApi
        .adminConfig(controller.signal)
        .then((data) => live() && setConfig({ status: "loaded", data }))
        .catch((cause: unknown) => live() && setConfig(toLoad(cause)));
      const runs = builderApi
        .adminRuns(limit, controller.signal)
        .then((data) => live() && setRuns({ status: "loaded", data }))
        .catch((cause: unknown) => live() && setRuns(toLoad(cause)));
      const users = builderApi
        .adminUsers(undefined, controller.signal)
        .then((data) => {
          if (!live()) return;
          const decided = decidedSinceRequest.current;
          setUsers({
            status: "loaded",
            data: { ...data, users: data.users.map((user) => decided.get(user.user_id) ?? user) },
          });
        })
        .catch((cause: unknown) => live() && setUsers(toLoad(cause)));
      void Promise.allSettled([config, runs, users]).then(() => {
        if (!live()) return;
        setRefreshing(false);
        setLoadedAt(new Date());
      });
    },
    [],
  );

  useEffect(() => {
    if (!real) return;
    load(runsLimit);
  }, [real, runsLimit, load]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // A 403 with nothing answered means the caller is not an administrator. Once any card has
  // data, a 403 is said on its own card instead, so it never hides what Builder did answer.
  const loads = [config.status, runs.status, users.status];
  const forbidden = loads.includes("forbidden") && !loads.includes("loaded");

  const replaceUser = (updated: AdminUser) => {
    decidedSinceRequest.current.set(updated.user_id, updated);
    setUsers((current) =>
      current.status === "loaded"
        ? {
            status: "loaded",
            data: { ...current.data, users: current.data.users.map((user) => (user.user_id === updated.user_id ? updated : user)) },
          }
        : current,
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader
        title={t("admin.title")}
        description={t("admin.desc")}
        meta={real && loadedAt ? t("admin.loadedAt", { at: formatDateTime(loadedAt.toISOString()) }) : undefined}
        actions={
          real ? (
            <Button loading={refreshing} onClick={() => load(runsLimit)} size="sm" type="button" variant="secondary">
              {t("admin.refresh")}
            </Button>
          ) : undefined
        }
      />

      {!real ? (
        <Card variant="dashed" className="text-sm">{t("admin.mock")}</Card>
      ) : forbidden ? (
        <Card role="alert" variant="error">
          <p className="font-semibold">{t("admin.forbiddenTitle")}</p>
          <p className="mt-1 text-sm">{t("admin.forbiddenBody")}</p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="text-sm font-semibold">{t("admin.policyTitle")}</h2>
            {config.status === "loading" ? <Skeleton className="mt-3 h-12 w-full" /> : null}
            <CardState className="mt-3" load={config} unsupported={t("admin.policyUnsupported")} />
            {config.status === "loaded" ? (
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Policy name="ENFORCE_OWNERSHIP" on={config.data.enforce_ownership} note={t("admin.enforceOwnership")} />
                <Policy
                  name="PUBLISH_SERVER_CREDENTIAL_FALLBACK"
                  on={config.data.publish_server_credential_fallback}
                  note={t("admin.publishFallback")}
                />
              </dl>
            ) : null}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("admin.runsTitle")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.runsNote")}</p>
            </div>
            {runs.status === "loading" ? <Skeleton className="m-5 h-24" /> : null}
            <CardState className="px-5 py-3" load={runs} unsupported={t("admin.runsUnsupported")} />
            {runs.status === "loaded" && runs.data.runs.length === 0 ? (
              <p className="px-5 py-3 text-sm text-muted-foreground" data-load="empty">
                {t("admin.runsEmpty")}
              </p>
            ) : null}
            {runs.status === "loaded" && runs.data.runs.length > 0 ? (
              <RunsShown
                limit={runsLimit}
                loading={refreshing}
                onMore={() => setRunsLimit(ADMIN_RUNS_MAX)}
                shown={runs.data.runs.length}
                total={runs.data.total}
              />
            ) : null}
            {runs.status === "loaded" && runs.data.runs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-semibold">{t("labels.run")}</th>
                      <th className="px-4 py-2 font-semibold">{t("admin.colStatus")}</th>
                      <th className="px-4 py-2 font-semibold">{t("admin.colOwner")}</th>
                      <th className="px-4 py-2 font-semibold">{t("admin.colStarted")}</th>
                      <th className="px-4 py-2 font-semibold">{t("admin.colFinished")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.data.runs.map((run) => (
                      <tr className="border-t border-border" key={run.run_id}>
                        <td className="px-4 py-2 font-mono text-xs">{run.run_id}</td>
                        <td className="px-4 py-2">{run.status}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{run.owner_id ? run.owner_id.slice(0, 12) : "—"}</td>
                        <td className="px-4 py-2 text-xs">{run.started_at ? formatDateTime(run.started_at) : "—"}</td>
                        <td className="px-4 py-2 text-xs">{run.finished_at ? formatDateTime(run.finished_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("admin.users.title")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.users.note")}</p>
            </div>
            {users.status === "loading" ? <Skeleton className="m-5 h-24" /> : null}
            <CardState className="px-5 py-3" load={users} unsupported={t("admin.users.unsupported")} />
            {users.status === "loaded" ? <UsersSection onChange={replaceUser} users={users.data.users} /> : null}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * How many runs the card shows. With Builder's `total` (contract 1.73.0) it is "N of M" and
 * more is offered only while runs are left out. Without it a full page means "there may be
 * more", never a number of runs Studio does not know.
 */
function RunsShown({
  shown,
  total,
  limit,
  loading,
  onMore,
}: {
  shown: number;
  total?: number;
  limit: number;
  loading: boolean;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const more = (
    <Button loading={loading} onClick={onMore} size="sm" type="button" variant="ghost">
      {t("admin.runsShowMore", { max: ADMIN_RUNS_MAX })}
    </Button>
  );
  if (total !== undefined) {
    const left = total - shown;
    return (
      <div className="flex flex-wrap items-center gap-3 px-5 pt-3 text-xs text-muted-foreground" data-runs-shown={left > 0 ? "partial" : "all"}>
        <span>{t("admin.runsShownOfTotal", { n: shown, total })}</span>
        {left > 0 ? limit < ADMIN_RUNS_MAX ? more : <span>{t("admin.runsAtMaxOfTotal", { max: ADMIN_RUNS_MAX, left })}</span> : null}
      </div>
    );
  }
  if (shown < limit) {
    return (
      <p className="px-5 pt-3 text-xs text-muted-foreground" data-runs-shown="all">
        {t("admin.runsShownAll", { n: shown })}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 pt-3 text-xs text-muted-foreground" data-runs-shown="capped">
      <span>{t("admin.runsShownCapped", { n: shown })}</span>
      {limit < ADMIN_RUNS_MAX ? more : <span>{t("admin.runsAtMax", { max: ADMIN_RUNS_MAX })}</span>}
    </div>
  );
}

/**
 * A card's state when it has no data to show: forbidden and unsupported are quiet words
 * (a fact about this Builder, not a failure to act on), a failure is an alert. `data-load`
 * pins the state for component tests; the word, not the colour, carries it.
 */
function CardState({ className, load, unsupported }: { className: string; load: Load<unknown>; unsupported: string }) {
  const { t } = useTranslation();
  if (load.status === "forbidden") {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-load="forbidden">
        {t("admin.cardForbidden")}
      </p>
    );
  }
  if (load.status === "unsupported") {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-load="unsupported">
        {unsupported}
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <p className={cn("text-sm text-status-failure", className)} data-load="error" role="alert">
        {t("admin.loadFailed", { message: load.message })}
      </p>
    );
  }
  return null;
}

function Policy({ name, on, note }: { name: string; on: boolean; note: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
      <dd className="mt-1 font-semibold">{on ? t("admin.on") : t("admin.off")}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}
