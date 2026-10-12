/**
 * Builder turning a build away because there is no room for it (#859).
 *
 * `POST /builds` and `POST /build` answer 429 in two cases, each with a stable `code`:
 *
 * - `build_owner_limit` (kpubdata-builder#1189, contract 1.111.0): in a multi-user
 *   deployment this user already has `limit` builds queued or running. Nothing is wrong
 *   with the build; it can be submitted again when one of theirs has ended.
 * - `build_queue_full` (1.79.0): the server's queue, or every build slot, is taken by
 *   whoever. It can be submitted again shortly.
 *
 * Both were shown as Builder's English sentence. Read here, each is said in the user's
 * language, with the limit when Builder gave it. A Builder before 1.111.0 never sends
 * the first code, and any other 429 is not one of these.
 *
 * Builder 1.118.0 (kpubdata-builder#1099) adds two more refusals of `POST /builds`, both
 * off until a deployment sets them (#939): 503 `disk_space_low` (the server's disk has
 * less free space than a build needs) and 409 `run_storage_quota_exceeded` (the user's
 * runs would pass the bytes one user may keep; the body gives `limit_bytes` and
 * `used_bytes`). A Builder before 1.118.0 never sends either.
 */
import { i18n } from "@/shared/i18n";
import { ApiError } from "@/shared/lib/builderApi";

export type BuildRefusal =
  /** `limit` is how many builds one user may have waiting or running; null when not said. */
  | { code: "build_owner_limit"; limit: number | null }
  | { code: "build_queue_full" }
  | { code: "disk_space_low" }
  /** Sizes in bytes; null when Builder did not give them. */
  | { code: "run_storage_quota_exceeded"; limitBytes: number | null; usedBytes: number | null };

const byteCount = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

/** `1073741824` as `1 GiB`: binary units, one decimal at most. */
function formatByteSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function buildRefusal(cause: unknown): BuildRefusal | null {
  if (!(cause instanceof ApiError) || ![409, 429, 503].includes(cause.status)) return null;
  const details = cause.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const code = "code" in details ? details.code : undefined;
  // Each code is read on the status Builder sends it with; the same code elsewhere is not it.
  if (cause.status === 503) return code === "disk_space_low" ? { code } : null;
  if (cause.status === 409) {
    if (code !== "run_storage_quota_exceeded") return null;
    return {
      code,
      limitBytes: byteCount("limit_bytes" in details ? details.limit_bytes : undefined),
      usedBytes: byteCount("used_bytes" in details ? details.used_bytes : undefined),
    };
  }
  if (code === "build_queue_full") return { code };
  if (code !== "build_owner_limit") return null;
  const limit = "limit" in details ? details.limit : undefined;
  return { code, limit: typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : null };
}

/** What to tell the user about `refusal`, in the language of the screen. */
export function buildRefusalMessage(refusal: BuildRefusal): string {
  if (refusal.code === "build_queue_full") return i18n.t("runs.build.queueFull");
  if (refusal.code === "disk_space_low") return i18n.t("runs.build.diskSpaceLow");
  if (refusal.code === "run_storage_quota_exceeded") {
    if (refusal.limitBytes === null || refusal.usedBytes === null) return i18n.t("runs.build.storageQuotaUnstated");
    return i18n.t("runs.build.storageQuota", { used: formatByteSize(refusal.usedBytes), limit: formatByteSize(refusal.limitBytes) });
  }
  if (refusal.limit === null) return i18n.t("runs.build.ownerLimitUnstated");
  // One has wording of its own: English would otherwise say "1 runs".
  return refusal.limit === 1 ? i18n.t("runs.build.ownerLimitOne") : i18n.t("runs.build.ownerLimit", { limit: refusal.limit });
}
