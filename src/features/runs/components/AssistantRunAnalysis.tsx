/**
 * Builds/Runs "Analyze this Run" inline result card (#255 §3).
 *
 * Does not auto-open the global Assistant drawer — the answer belongs in the same
 * view as the Selected Run's Pipeline/Quality/Events. No new Assistant
 * engine/store/context: reuses `useAssistantSession` (#256) as-is — when this
 * card mounts, the pending-seed consumption effect picks up the
 * `seedQuestion` BuildsPage already set and calls `ask()`.
 *
 * Exactly one turn is shown: the most recent turn matching the current
 * route context (i.e. not stale) (#256 stale-context guard). Switching runs
 * makes BuildsPage close this card itself, so a previous run's result never
 * looks valid in the new run's context.
 */
import { useMemo } from "react";
import { useAssistConfig } from "@/features/assistant/config";
import { ErrorNotice, EvidenceSection } from "@/features/assistant/AssistantContent";
import { MarkdownContent } from "@/features/assistant/MarkdownContent";
import { useAssistantSession } from "@/features/assistant/useAssistantSession";
import { Button, Card } from "@/shared/ui";
import { useTranslation } from "react-i18next";

export interface AssistantRunAnalysisProps {
  onClose: () => void;
  /** "Ask more" — the only case that opens the existing global Assistant drawer. */
  onAskMore: () => void;
}

/** Inline Assistant analysis card shown right under the Selected Run summary, above Pipeline/Stage Progress. */
export function AssistantRunAnalysis({ onClose, onAskMore }: AssistantRunAnalysisProps) {
  const { t } = useTranslation();
  const session = useAssistantSession();
  const { isConfigured } = useAssistConfig();
  // Handle the no-API-Key state first — do not bypass via
  // session.isDemoAvailable (always true in mock Builder mode). The pending
  // seed is always consumed by useAssistantSession's ordinary ask(), and ask()
  // decides no_key purely on isConfigured — so this card's canAsk must key
  // off exactly that criterion (isConfigured) to prevent a post-seed
  // no_key error up front.
  const canAsk = isConfigured;

  // Shows only the most recent turn matching the current route context (=
  // this run) — never blended with turns from other screens/previous runs
  // (#256 stale-context guard, same principle as AssistantContent's ContextBar).
  const turn = useMemo(() => {
    for (let i = session.turns.length - 1; i >= 0; i -= 1) {
      const candidate = session.turns[i];
      if (!session.isStale(candidate)) return candidate;
    }
    return null;
  }, [session.turns, session.isStale]);

  return (
    <Card className="border-accent/50">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("assistant.runAnalysis.title")}</h3>
        <button type="button" onClick={onClose} className="text-xs font-medium text-muted-foreground underline">
          {t("assistant.runAnalysis.close")}
        </button>
      </div>

      {!canAsk ? (
        // No API Key — there is no no_key ErrorNotice to render at all (no
        // seed means no turn). Rather than duplicating API-key input UI
        // here, it just points to the existing Assistant Drawer. "Ask more" is
        // also hidden in this state (gated by canAsk below).
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">{t("assistant.runAnalysis.needsKey")}</p>
          <Button size="sm" variant="secondary" onClick={onAskMore}>
            {t("assistant.runAnalysis.openSettings")}
          </Button>
        </div>
      ) : (
        <>
          {!turn ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("assistant.runAnalysis.preparing")}
            </div>
          ) : (
            <div className="mt-3 space-y-2.5 text-sm">
              {turn.status === "loading" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t("assistant.runAnalysis.thinking")}
                  <Button size="sm" variant="ghost" onClick={() => session.cancel(turn.id)}>
                    {t("assistant.runAnalysis.cancel")}
                  </Button>
                </div>
              ) : null}

              {turn.status === "error" && turn.error ? <ErrorNotice error={turn.error} /> : null}

              {turn.response ? (
                <>
                  {/* Reuses the same safe Markdown renderer as the Drawer (AssistantContent) (#320). */}
                  <MarkdownContent>{turn.response.answer}</MarkdownContent>

                  {/* Even with status "ok", if cross-check excluded evidence/
                      action/SQL, that fact is not hidden — uses the same
                      warning + EvidenceSection presentation as AssistantContent.
                      Distinct from the status === "error" ErrorNotice above. */}
                  {turn.error?.kind === "hallucinated_refs" ? (
                    <p role="alert" className="text-[11px] text-amber-700 dark:text-amber-400">
                      {turn.error.message}
                    </p>
                  ) : null}

                  <EvidenceSection turn={turn} />
                </>
              ) : null}
            </div>
          )}

          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={onAskMore}>
              {t("assistant.runAnalysis.askMore")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
