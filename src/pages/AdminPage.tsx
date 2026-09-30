/**
 * Administration (#409) — the live policy, every owner's runs (metadata only), and the
 * users of the Builder sign-up ledger with approval (kpubdata-builder#785).
 *
 * Reached from the menu only by an administrator, but the page does not rely on that:
 * each request is the Builder's decision, and a 403 is shown as "not an administrator"
 * rather than an empty page. Nothing here carries a credential — the Builder's admin
 * responses are strict schemas without one, and an owner is an irreversible hash.
 */
import { useEffect, useState } from "react";
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
import { Card, PageHeader, Skeleton } from "@/shared/ui";

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

  useEffect(() => {
    if (!real) return;
    const controller = new AbortController();
    builderApi
      .adminConfig(controller.signal)
      .then((data) => setConfig({ status: "loaded", data }))
      .catch((cause: unknown) => !controller.signal.aborted && setConfig(toLoad(cause)));
    builderApi
      .adminRuns(50, controller.signal)
      .then((data) => setRuns({ status: "loaded", data }))
      .catch((cause: unknown) => !controller.signal.aborted && setRuns(toLoad(cause)));
    builderApi
      .adminUsers(undefined, controller.signal)
      .then((data) => setUsers({ status: "loaded", data }))
      .catch((cause: unknown) => !controller.signal.aborted && setUsers(toLoad(cause)));
    return () => controller.abort();
  }, [real]);

  const forbidden = config.status === "forbidden" || runs.status === "forbidden" || users.status === "forbidden";

  const replaceUser = (updated: AdminUser) =>
    setUsers((current) =>
      current.status === "loaded"
        ? {
            status: "loaded",
            data: { ...current.data, users: current.data.users.map((user) => (user.user_id === updated.user_id ? updated : user)) },
          }
        : current,
    );

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
      <PageHeader title={t("admin.title")} description={t("admin.desc")} />

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
            {config.status === "error" ? <p className="mt-3 text-sm text-status-failure" role="alert">{config.message}</p> : null}
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
            {runs.status === "error" ? <p className="px-5 py-3 text-sm text-status-failure" role="alert">{runs.message}</p> : null}
            {runs.status === "loaded" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Run</th>
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
            {users.status === "unsupported" ? (
              <p className="px-5 py-3 text-sm text-muted-foreground">{t("admin.users.unsupported")}</p>
            ) : null}
            {users.status === "error" ? <p className="px-5 py-3 text-sm text-status-failure" role="alert">{users.message}</p> : null}
            {users.status === "loaded" ? <UsersSection onChange={replaceUser} users={users.data.users} /> : null}
          </Card>
        </>
      )}
    </main>
  );
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
