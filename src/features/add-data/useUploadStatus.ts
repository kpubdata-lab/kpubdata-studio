/**
 * What Builder says about the upload a draft names (#758).
 *
 * A draft opened from a saved spec carries only the `upload_id`, and a date kept with a
 * draft is the one Builder gave when the file was uploaded. In a multi-user deployment
 * Builder deletes an upload past its retention period, and the spec then fails to build
 * with "upload not found". Asking Builder when the draft is shown says so before a build
 * is tried: the upload is there until a date, it is already gone, or — when Builder cannot
 * be asked — whatever the draft remembered.
 */
import { useEffect, useState } from "react";

import { ApiError, builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";

export type UploadStatus =
  /** Nothing is known beyond what the draft remembered. */
  | { kind: "unknown" }
  /** Builder has the upload; `expiresAt` is when it deletes it, or null for never. */
  | { kind: "present"; expiresAt: string | null }
  /** Builder has no such upload for this user: deleted, expired, or never theirs. */
  | { kind: "gone" };

export function useUploadStatus(uploadId: string | null): UploadStatus {
  const [status, setStatus] = useState<UploadStatus>({ kind: "unknown" });

  useEffect(() => {
    setStatus({ kind: "unknown" });
    // The demo has no Builder to ask; its uploads never expire.
    if (!uploadId || !isRealBuilderEnabled()) return;
    const controller = new AbortController();
    builderApi
      .getUpload(uploadId, controller.signal)
      .then((meta) => {
        if (!controller.signal.aborted) setStatus({ kind: "present", expiresAt: meta.expires_at ?? null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // Only a 404 means the upload is gone. Anything else — the network, a 5xx — says
        // nothing about the upload, and the draft's own date stays.
        if (cause instanceof ApiError && cause.status === 404) setStatus({ kind: "gone" });
      });
    return () => controller.abort();
  }, [uploadId]);

  return status;
}
