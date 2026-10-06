/**
 * The signed-in user's uploads, with a way to delete one (#779, kpubdata-builder#1067).
 *
 * In a multi-user deployment Builder limits how many files and bytes a user may keep and
 * refuses an upload past the limit with "delete an upload you no longer need" — and there
 * was no screen that showed the uploads or deleted one.
 *
 * - Collapsed by default and loaded only when opened: it is a tool for the moment the
 *   limit is met, not something every file upload needs. It opens by itself when the
 *   upload just failed for the limit.
 * - Builder returns metadata only; nothing here can show or download a file's content.
 * - Deleting asks first, and says so when the file is the one this draft builds from.
 * - A deployment without limits (single-user) lists and deletes the same way.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import { builderApi, type UploadMetadata } from "@/shared/lib/builderApi";
import { Button } from "@/shared/ui";

type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; uploads: UploadMetadata[] }
  | { status: "error" };

export interface MyUploadsProps {
  /** The upload this draft builds from, if any: deleting it breaks the draft. */
  currentUploadId: string | null;
  /** Open at once — the upload just failed because a limit was reached. */
  openNow: boolean;
  /** Told after an upload is deleted, so the draft can let go of it. */
  onDeleted: (uploadId: string) => void;
}

export function MyUploads({ currentUploadId, openNow, onDeleted }: MyUploadsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(openNow);
  const [state, setState] = useState<ListState>({ status: "idle" });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { uploads } = await builderApi.listUploads();
      setState({ status: "loaded", uploads });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (openNow) setOpen(true);
  }, [openNow]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const remove = async (upload: UploadMetadata) => {
    const name = upload.original_filename ?? upload.upload_id;
    const question =
      upload.upload_id === currentUploadId
        ? t("addData.myUploads.confirmCurrent", { name })
        : t("addData.myUploads.confirm", { name });
    if (!window.confirm(question)) return;
    setDeleting(upload.upload_id);
    setDeleteFailed(false);
    try {
      await builderApi.deleteUpload(upload.upload_id);
      onDeleted(upload.upload_id);
      await load();
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left font-semibold"
      >
        <span aria-hidden="true" className="text-xs text-muted-foreground">{open ? "▼" : "▶"}</span>
        {t("addData.myUploads.title")}
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">{t("addData.myUploads.body")}</p>
          {state.status === "loading" ? <p className="text-muted-foreground">{t("addData.myUploads.loading")}</p> : null}
          {state.status === "error" ? (
            <p role="alert" className="text-status-failure">{t("addData.myUploads.loadFailed")}</p>
          ) : null}
          {deleteFailed ? <p role="alert" className="text-status-failure">{t("addData.myUploads.deleteFailed")}</p> : null}
          {state.status === "loaded" && state.uploads.length === 0 ? (
            <p className="text-muted-foreground">{t("addData.myUploads.empty")}</p>
          ) : null}
          {state.status === "loaded" && state.uploads.length > 0 ? (
            <ul className="divide-y divide-border">
              {state.uploads.map((upload) => {
                const name = upload.original_filename ?? upload.upload_id;
                return (
                  <li key={upload.upload_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {name}
                        {upload.upload_id === currentUploadId ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{t("addData.myUploads.inUse")}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("addData.myUploads.meta", {
                          format: upload.format,
                          bytes: upload.size_bytes,
                          at: formatDateTime(upload.created_at),
                        })}
                        {upload.expires_at ? ` · ${t("addData.myUploads.keptUntil", { at: formatDateTime(upload.expires_at) })}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={deleting !== null}
                      onClick={() => void remove(upload)}
                      aria-label={t("addData.myUploads.deleteNamed", { name })}
                    >
                      {deleting === upload.upload_id ? t("addData.myUploads.deleting") : t("addData.myUploads.delete")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
