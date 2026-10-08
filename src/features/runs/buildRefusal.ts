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
 */
import { i18n } from "@/shared/i18n";
import { ApiError } from "@/shared/lib/builderApi";

export type BuildRefusal =
  /** `limit` is how many builds one user may have waiting or running; null when not said. */
  | { code: "build_owner_limit"; limit: number | null }
  | { code: "build_queue_full" };

export function buildRefusal(cause: unknown): BuildRefusal | null {
  if (!(cause instanceof ApiError) || cause.status !== 429) return null;
  const details = cause.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const code = "code" in details ? details.code : undefined;
  if (code === "build_queue_full") return { code };
  if (code !== "build_owner_limit") return null;
  const limit = "limit" in details ? details.limit : undefined;
  return { code, limit: typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : null };
}

/** What to tell the user about `refusal`, in the language of the screen. */
export function buildRefusalMessage(refusal: BuildRefusal): string {
  if (refusal.code === "build_queue_full") return i18n.t("runs.build.queueFull");
  if (refusal.limit === null) return i18n.t("runs.build.ownerLimitUnstated");
  // One has wording of its own: English would otherwise say "1 runs".
  return refusal.limit === 1 ? i18n.t("runs.build.ownerLimitOne") : i18n.t("runs.build.ownerLimit", { limit: refusal.limit });
}
