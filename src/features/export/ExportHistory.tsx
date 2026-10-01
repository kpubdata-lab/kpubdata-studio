/**
 * The caller's past query exports — list, download again, delete (#648, builder#819).
 *
 * `GET /warehouse/exports` returns the unexpired exports in the caller's workspace,
 * newest first. Ownership and expiry are checked by Builder at the time of each call, so
 * an export that expires while the list is open is shown as expired (its download is
 * disabled) rather than silently failing, and a download that Builder answers with 410
 * marks it so. A delete asks first; deleting an export Builder no longer has (404
 * `export_not_found`) is treated as done, so a repeated or concurrent delete is safe.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { saveBlobAsFile } from "@/features/artifacts/api";
import { formatDateTime } from "@/features/datasets/model";
import { warehouseApi } from "@/features/sql/warehouseApi";
import { ApiError, type WarehouseExport } from "@/shared/lib/builderApi";
import { Button, Card, Skeleton } from "@/shared/ui";
import { ActionableStatus, NormalStatus } from "@/shared/ui/StatusState";

import { describeRefusal } from "./ExportPanel";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How one export reads on screen; `other` is a status this Studio does not know yet. */
export type ExportRowState = "completed" | "pending" | "expired" | "failed" | "cancelled" | "other";

/**
 * The state of one export as of `now`.
 *
 * Builder lists only unexpired exports, but `expires_at` can pass while the list is open:
 * past it, the export is expired whatever its last listed status said.
 */
export function exportRowState(item: Pick<WarehouseExport, "status" | "expires_at">, now: number): ExportRowState {
  if (item.status === "expired") return "expired";
  const expiresAt = Date.parse(item.expires_at);
  if (!Number.isNaN(expiresAt) && expiresAt <= now) return "expired";
  if (item.status === "completed") return "completed";
  if (item.status === "queued" || item.status === "running") return "pending";
  if (item.status === "failed" || item.status === "cancelled") return item.status;
  return "other";
}

/** Whether Builder can still hand out the bundle. */
export function canDownload(item: WarehouseExport, state: ExportRowState): boolean {
  return state === "completed" && item.download_path !== null;
}

function errorCode(cause: ApiError): string | undefined {
  const details = (cause.details ?? {}) as { code?: unknown; error?: unknown };
  const code = details.code ?? details.error;
  return typeof code === "string" ? code : undefined;
}

/**
 * What a failed download means: the export expired or vanished, its file is unavailable, or
 * anything else, which `describeRefusal` words exactly as the export panel does.
 */
export type DownloadFailure = { kind: "expired" } | { kind: "gone" } | { kind: "message"; message: string };

export function describeDownloadFailure(cause: unknown, t: Translate): DownloadFailure {
  if (cause instanceof ApiError) {
    const code = errorCode(cause);
    if (cause.status === 410 || code === "export_expired") return { kind: "expired" };
    if (cause.status === 404 && (code === "export_not_found" || code === undefined)) return { kind: "gone" };
    if (code === "export_unavailable") return { kind: "message", message: t("export.history.refused.unavailable") };
  }
  // Policy refusals (403 `redistribution_forbidden` included) read the same as in the export panel.
  return { kind: "message", message: describeRefusal(cause, t) };
}

/** True when a delete failed only because the export is already gone. */
function alreadyDeleted(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404 && (errorCode(cause) ?? "export_not_found") === "export_not_found";
}

function StateBadge({ state, raw }: { state: ExportRowState; raw: string }) {
  const { t } = useTranslation();
  switch (state) {
    case "completed":
      return <NormalStatus>{t("export.history.state.completed")}</NormalStatus>;
    case "pending":
      return <NormalStatus>{t("export.history.state.pending")}</NormalStatus>;
    case "expired":
      return <ActionableStatus tone="warning">{t("export.history.state.expired")}</ActionableStatus>;
    case "failed":
      return <ActionableStatus tone="failure">{t("export.history.state.failed")}</ActionableStatus>;
    case "cancelled":
      return <ActionableStatus tone="warning">{t("export.history.state.cancelled")}</ActionableStatus>;
    default:
      return <NormalStatus>{raw}</NormalStatus>;
  }
}

/** Why there is no download, for every state but `completed`. */
function stateReason(state: ExportRowState, t: Translate): string | null {
  switch (state) {
    case "expired":
      return t("export.history.reason.expired");
    case "failed":
      return t("export.history.reason.failed");
    case "cancelled":
      return t("export.history.reason.cancelled");
    case "pending":
      return t("export.history.reason.pending");
    default:
      return null;
  }
}

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "loaded"; exports: WarehouseExport[] };

/**
 * The caller's unexpired exports.
 *
 * @param props.refreshKey - Changes whenever an export was just created, so the list reloads.
 * @param props.now - The clock, for tests; defaults to `Date.now`.
 */
export function ExportHistory({ refreshKey = 0, now = Date.now }: { refreshKey?: number; now?: () => number }) {
  const { t } = useTranslation();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [busy, setBusy] = useState<Record<string, "download" | "delete">>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [expiredIds, setExpiredIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setList({ status: "loading" });
    void (async () => {
      try {
        const { exports } = await warehouseApi().listWarehouseExports(controller.signal);
        if (!controller.signal.aborted) setList({ status: "loaded", exports });
      } catch (cause) {
        if (!controller.signal.aborted) setList({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => controller.abort();
  }, [refreshKey, reloads]);

  const removeRow = useCallback((exportId: string) => {
    setList((prev) => (prev.status === "loaded" ? { ...prev, exports: prev.exports.filter((item) => item.export_id !== exportId) } : prev));
  }, []);

  function setRowBusy(exportId: string, value: "download" | "delete" | null) {
    setBusy((prev) => {
      const next = { ...prev };
      if (value) next[exportId] = value;
      else delete next[exportId];
      return next;
    });
  }

  function setRowError(exportId: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[exportId] = message;
      else delete next[exportId];
      return next;
    });
  }

  async function download(item: WarehouseExport) {
    setRowBusy(item.export_id, "download");
    setRowError(item.export_id, null);
    setNotice(null);
    try {
      const { blob, filename } = await warehouseApi().downloadWarehouseExport(item.export_id);
      saveBlobAsFile(blob, filename);
    } catch (cause) {
      const failure = describeDownloadFailure(cause, t);
      if (failure.kind === "expired") setExpiredIds((prev) => new Set(prev).add(item.export_id));
      else if (failure.kind === "gone") {
        removeRow(item.export_id);
        setNotice(t("export.history.gone"));
      } else setRowError(item.export_id, failure.message);
    } finally {
      setRowBusy(item.export_id, null);
    }
  }

  async function remove(item: WarehouseExport) {
    if (busy[item.export_id]) return;
    if (!window.confirm(t("export.history.confirmDelete", { table: item.manifest.snapshot.logical_name, id: item.export_id }))) return;
    setRowBusy(item.export_id, "delete");
    setRowError(item.export_id, null);
    setNotice(null);
    try {
      await warehouseApi().deleteWarehouseExport(item.export_id);
      removeRow(item.export_id);
    } catch (cause) {
      if (alreadyDeleted(cause)) removeRow(item.export_id);
      else setRowError(item.export_id, t("export.history.deleteFailed", { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setRowBusy(item.export_id, null);
    }
  }

  const at = now();
  return (
    <Card className="space-y-3" data-testid="export-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("export.history.title")}</h3>
        <Button disabled={list.status === "loading"} onClick={() => setReloads((value) => value + 1)} size="sm" variant="ghost">
          {t("export.history.refresh")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("export.history.note")}</p>
      {notice ? (
        <p className="text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {list.status === "loading" ? <Skeleton className="h-16 w-full" /> : null}
      {list.status === "error" ? (
        <p className="text-sm text-status-failure" role="alert">
          {t("export.history.loadFailed", { message: list.message })}
        </p>
      ) : null}
      {list.status === "loaded" && list.exports.length === 0 ? <p className="text-sm text-muted-foreground">{t("export.history.empty")}</p> : null}
      {list.status === "loaded" && list.exports.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.exports.map((item) => {
            const state = expiredIds.has(item.export_id) ? "expired" : exportRowState(item, at);
            const reason = stateReason(state, t);
            const rowBusy = busy[item.export_id];
            const snap = item.manifest.snapshot;
            return (
              <li className="flex flex-col gap-2 p-3 text-sm" data-export-id={item.export_id} data-state={state} key={item.export_id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="break-all font-mono text-xs">
                      {t("export.snapshot", { table: snap.logical_name, snapshot: snap.snapshot_id, revision: snap.revision })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("export.history.meta", {
                        format: item.request.format,
                        rows: item.manifest.output.row_count,
                        created: formatDateTime(item.created_at),
                        expires: formatDateTime(item.expires_at),
                      })}
                    </p>
                  </div>
                  <StateBadge raw={item.status} state={state} />
                </div>
                {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!canDownload(item, state) || rowBusy !== undefined}
                    loading={rowBusy === "download"}
                    onClick={() => void download(item)}
                    size="sm"
                    variant="secondary"
                  >
                    {t("export.download")}
                  </Button>
                  <Button disabled={rowBusy !== undefined} loading={rowBusy === "delete"} onClick={() => void remove(item)} size="sm" variant="ghost">
                    {t("export.history.delete")}
                  </Button>
                </div>
                {rowErrors[item.export_id] ? (
                  <p className="text-sm text-status-failure" role="alert">
                    {rowErrors[item.export_id]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
