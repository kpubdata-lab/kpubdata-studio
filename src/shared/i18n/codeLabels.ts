/**
 * Builder's codes, as words on the screen (#843).
 *
 * A stage status (`not_run`), an event name (`run_submitted`) or a summary status (`ok`)
 * is Builder's vocabulary, not the user's. Each group below maps the codes the contract
 * declares to a `codes.*` key. A code the contract does not declare — a newer Builder —
 * is shown as Builder sent it: Studio does not invent a word for a value it has not seen.
 *
 * The label is looked up when it is rendered, through the `t` the caller passes, so a
 * language switch is reflected (a label table at module scope freezes the language).
 */
import type { TFunction } from "i18next";
import { BUILDER_ENUMS } from "@/shared/lib/builderEnums";

const GROUPS = {
  event: BUILDER_ENUMS.BuildEventName,
  eventStatus: BUILDER_ENUMS.BuildEventStatus,
  eventStage: BUILDER_ENUMS.BuildEventStageName,
  stageStatus: BUILDER_ENUMS.StageStatusValue,
} as const satisfies Record<string, readonly string[]>;

export type CodeGroup = keyof typeof GROUPS;

/** The screen word for one of Builder's codes, or the code itself when it is not known. */
export function codeLabel(t: TFunction, group: CodeGroup, code: string): string {
  const known: readonly string[] = GROUPS[group];
  return known.includes(code) ? t(`codes.${group}.${code}`) : code;
}

/** The run statuses `status.*` already words; a summary's `ok` is a success. */
const RUN_STATUS_KEYS: Record<string, string> = {
  ok: "succeeded",
  queued: "queued",
  running: "running",
  cancelling: "cancelling",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

/** A run's status — a job's or a build summary's — in the current language. */
export function runStatusLabel(t: TFunction, status: string): string {
  const key = RUN_STATUS_KEYS[status];
  return key ? t(`status.${key}`) : status;
}
