/**
 * Execute Generated SQL — a wrapper around the Builder `/query` call (#256, Builder #504 contract 1.7.0).
 *
 * SQL is not auto-executed here — this function is called from `useAssistantSession` only when the user
 * explicitly clicks the "execute" button. Although Builder rejects bronze-stage execution, we block
 * the request client-side first (reduces unnecessary 401/403 round-trips and "maybe it'll work?" retries).
 *
 * Final SQL safety checks (blocking mutations/filesystem/network access, CTE shadowing, etc.) are
 * handled by Builder — Studio does not parse or re-validate SQL here.
 */
import { i18n } from "@/shared/i18n";
import { ApiError, builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import { queryErrorResponseSchema } from "@/shared/lib/builderApi.schema";
import type { AssistantContext, AssistantGeneratedSql, AssistantQueryState } from "./types";

/**
 * Determine whether Generated SQL can be executed in the current context.
 *
 * @param context - The AssistantContext at the point of execution attempt (must be post-stale-guard).
 * @param sql - The Generated SQL to execute.
 * @returns null if execution is possible, otherwise a user-facing reason why not.
 */
export function blockedReason(context: AssistantContext, sql: AssistantGeneratedSql): string | null {
  if (context.stage === "bronze") {
    return i18n.t("assistant.query.bronzeNotAllowed");
  }
  if (context.stage !== sql.stage) {
    return i18n.t("assistant.query.stageMismatch", {
      current: context.stage ?? i18n.t("assistant.query.stageNone"),
      proposed: sql.stage,
    });
  }
  if (!context.datasetId || !context.runId) {
    return i18n.t("assistant.query.needsDatasetRun");
  }
  return null;
}

function classifyError(cause: unknown): AssistantQueryState {
  if (cause instanceof ApiError) {
    const parsed = queryErrorResponseSchema.safeParse(cause.details);
    if (parsed.success && parsed.data.code) {
      return { status: "error", code: parsed.data.code, message: parsed.data.error };
    }
    if (cause.status === 0) return { status: "error", code: "network", message: cause.message };
    return { status: "error", code: "unknown", message: cause.message };
  }
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return { status: "error", code: "unknown", message: i18n.t("assistant.query.cancelled") };
  }
  return {
    status: "error",
    code: "unknown",
    message: cause instanceof Error ? cause.message : i18n.t("assistant.query.unknownError"),
  };
}

/**
 * Call the Builder `/query` endpoint to execute Generated SQL.
 *
 * @param context - The AssistantContext at execution time (requires datasetId/runId/stage).
 * @param sql - The Generated SQL to execute (may have been reviewed/edited by the user).
 * @param signal - Abort signal for cancellation.
 * @returns Execution result state (success/error is structured; never throws even on failure).
 */
export async function runAssistantQuery(
  context: AssistantContext,
  sql: AssistantGeneratedSql,
  signal?: AbortSignal,
): Promise<AssistantQueryState> {
  const blocked = blockedReason(context, sql);
  if (blocked) return { status: "blocked", reason: blocked };

  if (!isRealBuilderEnabled()) {
    return {
      status: "error",
      code: "mock_mode",
      message: i18n.t("assistant.query.mockUnsupported"),
    };
  }

  try {
    const result = await builderApi.query(
      {
        dataset_id: context.datasetId!,
        run_id: context.runId!,
        stage: sql.stage,
        sql: sql.sql,
        ...(sql.source ? { source: sql.source } : {}),
      },
      signal,
    );
    return { status: "success", result };
  } catch (cause) {
    return classifyError(cause);
  }
}
