/**
 * One downloadable artifact file of a run (#30), and why a download was refused (#643).
 *
 * A failed download used to show Builder's raw message under the row, so a Silver file
 * held back for its declared PII looked like any other 403 and nothing said that the Gold
 * file next to it would download. Policy refusals (`artifactDownloadRefusal`) now get their
 * own notice — what was refused, why, and what to do instead — in plain text, not in the
 * failure colour: the request did not fail, the data is held back on purpose. Every other
 * failure stays an error alert.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { downloadArtifact, saveBlobAsFile } from "@/features/artifacts/api";
import { artifactDownloadRefusal, type ArtifactDownloadRefusal } from "@/features/artifacts/downloadRefusal";
import { i18n } from "@/shared/i18n";
import { Button } from "@/shared/ui";
import { NormalStatus } from "@/shared/ui/StatusState";

type RowDownloadState =
  | { status: "idle" }
  | { status: "downloading" }
  | { status: "refused"; refusal: ArtifactDownloadRefusal }
  | { status: "error"; message: string };

/** Extract display name and format (extension) from file path. */
export function describeFile(path: string): { name: string; format: string } {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return { name, format: dot >= 0 ? name.slice(dot + 1) : "—" };
}

/**
 * Explains a policy refusal of one artifact download, with the next action.
 *
 * @param props.refusal - The refusal read from Builder's response.
 * @returns The notice.
 */
export function ArtifactDownloadRefusalNotice({ refusal }: { refusal: ArtifactDownloadRefusal }) {
  const { t } = useTranslation();
  let reason: string;
  let next: string;
  switch (refusal.code) {
    case "declared_pii_withheld":
      reason =
        refusal.columns.length > 0
          ? t("artifacts.refusal.declaredPii", { columns: refusal.columns.join(", ") })
          : t("artifacts.refusal.declaredPiiNoColumns");
      next = t("artifacts.refusal.declaredPiiNext");
      break;
    case "pii_declaration_unavailable":
      reason = refusal.dataset
        ? t("artifacts.refusal.piiUnavailable", { dataset: refusal.dataset })
        : t("artifacts.refusal.piiUnavailableNoDataset");
      next = t("artifacts.refusal.piiUnavailableNext");
      break;
    case "redistribution_forbidden":
      reason =
        refusal.sources.length > 0
          ? t("artifacts.refusal.redistributionSources", { sources: refusal.sources.join(", ") })
          : t("artifacts.refusal.redistribution");
      next = t("artifacts.refusal.redistributionNext");
      break;
  }
  return (
    <span role="status" data-refusal={refusal.code} className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
      <span className="font-medium">{t("artifacts.refusal.title")}</span>
      <NormalStatus>{reason}</NormalStatus>
      <span className="text-muted-foreground">{next}</span>
    </span>
  );
}

/**
 * Single artifact file row. `path` is the canonical run-relative POSIX path from
 * `GET /artifacts/{run_id}`. Download uses the exact run_id + this path in an authenticated
 * Builder request (`downloadArtifact`) and saves the result as a Blob. During download, the button
 * is disabled to prevent duplicate clicks, and errors are displayed only for this row — not for
 * the entire page.
 */
export function ArtifactRow({ runId, path }: { runId: string; path: string }) {
  const { t } = useTranslation();
  const { name, format } = describeFile(path);
  const [state, setState] = useState<RowDownloadState>({ status: "idle" });

  const onDownload = useCallback(() => {
    if (state.status === "downloading") return;
    setState({ status: "downloading" });
    downloadArtifact(runId, path)
      .then(({ blob, filename }) => {
        saveBlobAsFile(blob, filename);
        setState({ status: "idle" });
      })
      .catch((cause: unknown) => {
        const refusal = artifactDownloadRefusal(cause);
        if (refusal) {
          setState({ status: "refused", refusal });
          return;
        }
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : i18n.t("artifacts.errors.download"),
        });
      });
  }, [runId, path, state.status]);

  return (
    <li className="grid grid-cols-[1.6fr_0.6fr_0.8fr] items-center gap-4 border-b border-border px-6 py-3 text-sm last:border-0">
      <span className="break-all font-medium">{name}</span>
      <span className="uppercase text-muted-foreground">{format}</span>
      <span className="flex flex-col items-start gap-1">
        <Button
          size="sm"
          variant="secondary"
          loading={state.status === "downloading"}
          disabled={state.status === "downloading"}
          onClick={onDownload}
        >
          {t("artifacts.files.download")}
        </Button>
        {state.status === "refused" ? <ArtifactDownloadRefusalNotice refusal={state.refusal} /> : null}
        {state.status === "error" ? (
          <span role="alert" className="text-xs text-status-failure">
            {state.message}
          </span>
        ) : null}
      </span>
    </li>
  );
}
