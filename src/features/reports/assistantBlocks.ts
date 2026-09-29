/**
 * Assistant reference note → Report ASSISTANT_INTERPRETATION block conversion (#258 §6, §7).
 *
 * `ADD_REPORT_BLOCK` already implemented·approved in #256, queued in `features/assistant/reportInbox.ts`.
 * No new action contract created; consume that queue as-is. Require user approval again here (#258 §7
 * step 5: show note → show evidence → check context → user approval → add block) — Assistant chat approval
 * is "enqueue as reference note"; actually reflecting to Report requires separate approval step.
 */
import type { AssistantReportNote } from "@/features/assistant/reportInbox";
import type { AssistantInterpretationBlock, ReportDraft } from "./types";

/** Check if queue note's context matches Report's reference dataset/run. */
export function noteMatchesReportContext(note: AssistantReportNote, report: Pick<ReportDraft, "datasetId" | "baseRunId">): boolean {
  return note.context.datasetId === report.datasetId && note.context.runId === report.baseRunId;
}

function newBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `assistant-${crypto.randomUUID()}`;
  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Convert approved Assistant reference note to ASSISTANT_INTERPRETATION block.
 *
 * Allow adding notes from other dataset/run (#258 §7 — not completely blocked) but keep
 * `isSameContext=false` so UI can clearly distinguish as "reference analysis · different run",
 * not blended with canonical analysis.
 */
export function reportNoteToBlock(note: AssistantReportNote, report: Pick<ReportDraft, "datasetId" | "baseRunId">): AssistantInterpretationBlock {
  const now = new Date().toISOString();
  return {
    id: newBlockId(),
    provenance: "ASSISTANT_INTERPRETATION",
    note: note.note,
    reason: note.reason,
    sourceContext: note.context,
    isSameContext: noteMatchesReportContext(note, report),
    generatedAt: note.savedAt,
    createdAt: now,
    updatedAt: now,
  };
}
