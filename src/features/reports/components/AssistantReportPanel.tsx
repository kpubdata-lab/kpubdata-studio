/**
 * "7. Assistant Analysis" section panel (#258 Assistant Report UX redesign).
 *
 * Previously showed entire `AssistantContent compact` — API Key/Model/Base URL setup, demo questions,
 * free chat — expanded all at once. That looked like embedding entire Assistant app inside Reports with
 * unclear intent. This panel instead shows "Generate AI interpretation for current Report" as default,
 * with BYOK setup/free chat revealed only on [AI Settings]/[Ask directly] click.
 *
 * No new provider/LLM/evidence pipeline or action contract — reuse `useAssistantSession`(#256) as-is;
 * preset is just a simple question template on top. Applying generated answer to Report uses same
 * `AssistantInterpretationBlock` shape (`reportNoteToBlock` field structure in `assistantBlocks.ts`) — but
 * since this panel lives inside Report editor already, bypass reportInbox queue: generate → preview
 * → approve all on one screen. Nothing saved to Report until `onApprove` called (local preview only).
 *
 * Context (datasetId/baseRunId) is fixed by Report. `useAssistantSession` reads context from URL
 * pathname+search (`features/assistant/context.ts`), so while this panel is mounted, always normalize
 * URL to Report's `?dataset=&run=` — no auto-switch to latest run (#258 §8/§6 same invariant).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAssistConfig } from "@/features/assistant/config";
import { ApiKeySetup, AssistantContent } from "@/features/assistant/AssistantContent";
import { useAssistantSession } from "@/features/assistant/useAssistantSession";
import type { AssistantTurn } from "@/features/assistant/types";
import { i18n } from "@/shared/i18n";
import { Button, Card } from "@/shared/ui";
import { renderMarkdownToReact } from "../markdown";
import type { AssistantInterpretationBlock, ReportDraft } from "../types";

interface Preset {
  id: string;
  label: string;
  question: string;
}

/** Comprehensive analysis is primary CTA, other four are quick actions (#258 §2-1).
 * Not a new action contract — just question template passed straight to `useAssistantSession.ask/askDemo`. */
/**
 * Preset label is button text; question is user query sent to Assistant as-is — both follow screen language.
 * English UI + Korean question = Korean response. Constant would ignore language switch, so create at call time.
 */
const COMPREHENSIVE_PRESET_ID = "comprehensive";
const QUICK_PRESET_IDS = ["quality", "pipeline", "ideas", "caveats"] as const;

function preset(id: string): Preset {
  return {
    id,
    label: i18n.t(`reports.assistantPanel.preset.${id}.label`),
    question: i18n.t(`reports.assistantPanel.preset.${id}.question`),
  };
}

function mockDisclaimer(): string {
  return i18n.t("reports.assistantPanel.mockDisclaimer");
}

function newBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `assistant-${crypto.randomUUID()}`;
  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Whether turn.context matches this Report's reference dataset/run (distinguish reference vs canonical analysis). */
function turnMatchesReport(turn: AssistantTurn, report: Pick<ReportDraft, "datasetId" | "baseRunId">): boolean {
  return turn.context.datasetId === report.datasetId && turn.context.runId === report.baseRunId;
}

export function AssistantReportPanel({
  report,
  onApprove,
}: {
  report: Pick<ReportDraft, "id" | "datasetId" | "baseRunId">;
  onApprove: (block: AssistantInterpretationBlock) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useAssistantSession();
  const { isConfigured } = useAssistConfig();
  const comprehensive = preset(COMPREHENSIVE_PRESET_ID);
  const quickPresets = QUICK_PRESET_IDS.map((id) => preset(id));

  const [showByok, setShowByok] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  // Keep Report's fixed dataset/run reflected in URL — do not auto-switch to latest run
  // (#258 §8 invariant). If already matching, do nothing (avoid unnecessary history updates).
  useEffect(() => {
    if (session.liveContext.datasetId === report.datasetId && session.liveContext.runId === report.baseRunId) {
      return;
    }
    const params = new URLSearchParams({ dataset: report.datasetId, run: report.baseRunId });
    navigate(`/reports/${encodeURIComponent(report.id)}?${params.toString()}`, { replace: true });
  }, [report.id, report.datasetId, report.baseRunId, session.liveContext.datasetId, session.liveContext.runId, navigate]);

  const isDemoMode = !isConfigured && session.isDemoAvailable;
  const canGenerate = isConfigured || session.isDemoAvailable;

  function generate(question: string) {
    setActiveQuestion(question);
    if (!isConfigured && session.isDemoAvailable) {
      void session.askDemo(question);
      return;
    }
    void session.ask(question);
  }

  // Show only the last-requested turn matching this Report's context in preview. Do not mix
  // turns created in other screens/contexts.
  const activeTurn = activeQuestion
    ? [...session.turns]
        .reverse()
        .find((turn) => turn.question === activeQuestion && turnMatchesReport(turn, report))
    : undefined;

  function approve() {
    if (!activeTurn?.response) return;
    const now = new Date().toISOString();
    const block: AssistantInterpretationBlock = {
      id: newBlockId(),
      provenance: "ASSISTANT_INTERPRETATION",
      note: activeTurn.response.answer,
      reason: activeTurn.isDemo
        ? t("reports.assistantPanel.reasonDemo")
        : t("reports.assistantPanel.reason"),
      sourceContext: {
        datasetId: activeTurn.context.datasetId,
        runId: activeTurn.context.runId,
        stage: activeTurn.context.stage,
      },
      isSameContext: turnMatchesReport(activeTurn, report),
      generatedAt: activeTurn.createdAt,
      createdAt: now,
      updatedAt: now,
    };
    onApprove(block);
    setActiveQuestion(null);
  }

  if (showChat) {
    return (
      <Card className="space-y-3" data-testid="assistant-report-chat">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("reports.assistantPanel.chatTitle", {
              dataset: report.datasetId,
              run: report.baseRunId,
            })}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setShowChat(false)}>
            {t("reports.assistantPanel.close")}
          </Button>
        </div>
        <AssistantContent compact />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="assistant-report-panel">
      <p className="text-xs text-muted-foreground">
        {t("reports.assistantPanel.intro")}
      </p>

      {!isConfigured ? (
        <Card variant="dashed" className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
          <span className="text-foreground">{t("reports.assistantPanel.needsKey")}</span>
          <Button size="sm" variant="ghost" onClick={() => setShowByok((prev) => !prev)}>
            {t("reports.assistantPanel.openAiSettings")}
          </Button>
        </Card>
      ) : null}

      {showByok ? <ApiKeySetup /> : null}

      {isDemoMode ? (
        <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
          {mockDisclaimer()}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!canGenerate}
          loading={activeTurn?.question === comprehensive.question && activeTurn.status === "loading"}
          onClick={() => generate(comprehensive.question)}
        >
          {isDemoMode ? t("reports.assistantPanel.generateDemo") : comprehensive.label}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {quickPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={!canGenerate}
            onClick={() => generate(preset.question)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Button size="sm" variant="ghost" onClick={() => setShowChat(true)}>
          {t("reports.assistantPanel.askDirectly")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowByok((prev) => !prev)}>
          {t("reports.assistantPanel.aiSettings")}
        </Button>
      </div>

      {activeTurn ? (
        <Card className="space-y-2 border-indigo-200 dark:border-indigo-900/60" data-testid="assistant-report-preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("reports.block.assistantTitle")}</h3>
            {activeTurn.isDemo ? (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
                DEMO
              </span>
            ) : null}
          </div>

          {activeTurn.isDemo ? (
            <p className="text-xs font-medium text-violet-800 dark:text-violet-300">{mockDisclaimer()}</p>
          ) : null}

          {activeTurn.status === "loading" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("reports.assistantPanel.generating")}
              <Button size="sm" variant="ghost" onClick={() => session.cancel(activeTurn.id)}>
                {t("reports.assistantPanel.cancel")}
              </Button>
            </div>
          ) : null}

          {activeTurn.status === "error" ? (
            <p role="alert" className="text-xs text-red-700 dark:text-red-300">
              {t("reports.assistantPanel.error")}
            </p>
          ) : null}

          {activeTurn.response ? (
            <>
              <div className="space-y-2 text-sm text-foreground">
                {renderMarkdownToReact(activeTurn.response.answer)}
              </div>
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold uppercase tracking-wider">{t("reports.assistantPanel.evidence")}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Dataset: {report.datasetId}</li>
                  <li>Run: {report.baseRunId}</li>
                  {activeTurn.response.evidenceRefs.map((ref) => (
                    <li key={`${ref.kind}:${ref.id}`}>{ref.label}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          {activeTurn.status !== "loading" ? (
            <div className="flex flex-wrap gap-2">
              {activeTurn.response ? (
                <Button size="sm" onClick={approve}>
                  {t("reports.assistantPanel.addToReport")}
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => generate(activeTurn.question)}>
                {t("reports.assistantPanel.regenerate")}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
