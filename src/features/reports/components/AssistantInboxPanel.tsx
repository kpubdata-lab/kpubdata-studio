/**
 * Assistant reference note queue → Report approval panel (#258 §7).
 *
 * Shows notes stashed in `features/assistant/reportInbox.ts`(#256), already approved once by user in Assistant chat.
 * User re-approves here: note text → linked evidence (context) → matches current Report's dataset/run?
 * → user approval order → only then add as ASSISTANT_INTERPRETATION block to Report. Never auto-added.
 */
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { listAssistantReportNotes, removeAssistantReportNote, type AssistantReportNote } from "@/features/assistant/reportInbox";
import { Card, EmptyState } from "@/shared/ui";
import { noteMatchesReportContext, reportNoteToBlock } from "../assistantBlocks";
import type { AssistantInterpretationBlock, ReportDraft } from "../types";

export function AssistantInboxPanel({
  report,
  onApprove,
  onNotesChanged,
}: {
  report: Pick<ReportDraft, "datasetId" | "baseRunId">;
  onApprove: (block: AssistantInterpretationBlock) => void;
   /** Called when queue changes via approval/discard (refresh Report Context sidebar pending note count). */
  onNotesChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<AssistantReportNote[]>([]);

  useEffect(() => {
    setNotes(listAssistantReportNotes());
  }, []);

  function approve(note: AssistantReportNote) {
    onApprove(reportNoteToBlock(note, report));
    removeAssistantReportNote(note);
    setNotes(listAssistantReportNotes());
    onNotesChanged?.();
  }

  function discard(note: AssistantReportNote) {
    removeAssistantReportNote(note);
    setNotes(listAssistantReportNotes());
    onNotesChanged?.();
  }

  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("reports.assistantInbox.title")}</p>
      {notes.length === 0 ? (
        <EmptyState
          className="py-6"
          title={t("reports.assistantInbox.emptyTitle")}
          description={t("reports.assistantInbox.emptyDesc")}
        />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {notes.map((note, index) => {
            const sameContext = noteMatchesReportContext(note, report);
            return (
              <li key={`${note.savedAt}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                <p className="text-foreground">{note.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[note.context.datasetId, note.context.runId, note.context.stage].filter(Boolean).join(" · ") ||
                    t("reports.assistantInbox.noContext")}
                  {" · "}
                  {new Date(note.savedAt).toLocaleString("ko-KR")}
                </p>
                <p
                  className={`mt-1 text-xs font-medium ${sameContext ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                >
                  {sameContext ? t("reports.assistantInbox.sameContext") : t("reports.assistantInbox.otherContext")}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => approve(note)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    {t("reports.assistantInbox.add")}
                  </button>
                  <button
                    type="button"
                    onClick={() => discard(note)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    {t("reports.assistantInbox.dismiss")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
