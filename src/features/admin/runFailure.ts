/**
 * A run's failure on the administration screen, in words (#906).
 *
 * `GET /admin/runs` gives each run `error_code` and `error_stage` from contract 1.116.0
 * (kpubdata-builder#1120). They are plain strings in the contract, not enums: the lists
 * below are the ones its description names, so they are written here rather than
 * generated. A code or stage outside them — a newer Builder — or a null is shown as
 * "unknown", never as Builder's raw value and never parsed out of the `error` sentence.
 *
 * Each known code has a recovery hint for the administrator: what the run's owner can do
 * next. Labels are looked up when rendered, through the caller's `t`.
 */
import type { TFunction } from "i18next";

export const RUN_FAILURE_CODES = [
  // A provider's refusal.
  "application_required",
  "auth_unknown",
  "params_invalid",
  "rate_limited",
  "temporarily_unavailable",
  "network_error",
  "retired",
  // Any other source failure.
  "pipeline_failed",
  // A composition's rule.
  "join_key_missing",
  "join_key_type_mismatch",
  "join_null_key",
  "join_cardinality_mismatch",
  "join_duplicate_key",
  "join_output_column_conflict",
  "composition_failed",
  // A refused table commit.
  "conflict",
  "empty_result",
  "table_exists",
  "commit_failed",
  // Why a run was cancelled or ended without a manifest.
  "cancelled",
  "time_limit_exceeded",
  "server_shutdown",
  "interrupted",
  "credentials_required",
  "enqueue_failed",
  "failed_without_manifest",
] as const;

export const RUN_FAILURE_STAGES = [
  "bronze",
  "silver",
  "gold",
  "export",
  "composition",
  "warehouse",
  "queued",
  "started",
] as const;

export type RunFailureCode = (typeof RUN_FAILURE_CODES)[number];
export type RunFailureStage = (typeof RUN_FAILURE_STAGES)[number];

const isCode = (value: string | null | undefined): value is RunFailureCode =>
  value != null && (RUN_FAILURE_CODES as readonly string[]).includes(value);

const isStage = (value: string | null | undefined): value is RunFailureStage =>
  value != null && (RUN_FAILURE_STAGES as readonly string[]).includes(value);

/** Statuses that end a run without success, so a missing cause is worth saying. */
const ENDED_BADLY = new Set(["failed", "cancelled"]);

export interface RunFailureWords {
  code: string;
  stage: string;
  /** Null when the code is not known: Studio does not guess a recovery. */
  hint: string | null;
  known: boolean;
}

/**
 * The words for a run's failure, or null for a run that has none to show — it did not
 * fail and Builder sent no code.
 */
export function runFailureWords(
  t: TFunction,
  run: { status: string; error_code?: string | null; error_stage?: string | null },
): RunFailureWords | null {
  const code = run.error_code ?? null;
  if (code === null && !ENDED_BADLY.has(run.status)) return null;
  const stage = isStage(run.error_stage) ? t(`admin.failure.stage.${run.error_stage}`) : t("admin.failure.unknownStage");
  if (!isCode(code)) {
    return { code: t("admin.failure.unknownCode"), stage, hint: null, known: false };
  }
  return { code: t(`admin.failure.code.${code}`), stage, hint: t(`admin.failure.hint.${code}`), known: true };
}
