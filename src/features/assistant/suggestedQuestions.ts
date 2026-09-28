/**
 * Assistant suggested questions — choose "questions user might ask next" deterministically from current context
 * and recent conversation (#S-assistant-suggest). No extra LLM calls.
 *
 * `AssistantContent` (right suggestion panel + pre-first-question onboarding chip) and Home Assistant hero share this
 * helper — don't expose fixed string arrays directly to UI.
 *
 * Principles:
 * - Expose only questions actually answerable with current context (dataset/run/quality/stage).
 * - Don't force Quality/Build failure/SQL questions when Dataset/Run/Quality missing.
 * - If recent turn exists, choose follow-up from that turn's **structured cues** (response.generatedSql /
 *   evidence.quality / evidence.catalog / evidence.dataset / suggestedActions). No NLP parsing of assistant
 *   prose or arbitrary string matching.
 * - If structural cues insufficient, fallback to generic follow-up concretizing recent question.
 * - Don't mix Suggested Action (execute/navigate) with this — here, only "next questions".
 */
import type { AssistantContext, AssistantTurn } from "./types";
import { i18n } from "@/shared/i18n";

/**
 * Initial questions to show when Dataset/Run/Quality context missing (Home hero, empty /kubi).
 * Does not include Quality/Build failure/SQL questions.
 */
export const START_QUESTIONS = [
  i18n.t("assistant.questions.q01"),
  i18n.t("assistant.questions.q02"),
  i18n.t("assistant.questions.q03"),
  i18n.t("assistant.questions.q04"),
];

/**
 * @deprecated Not exposed directly to UI — use `getSuggestedQuestions`. Kept for backward compatibility;
 * content is summary/quality/failure/SQL questions for "when context exists".
 */
export const SUGGESTED_QUESTIONS = [
  i18n.t("assistant.questions.q05"),
  i18n.t("assistant.questions.q06"),
  i18n.t("assistant.questions.q07"),
  i18n.t("assistant.questions.q08"),
];

export interface SuggestedQuestionsInput {
  /** Route context at this moment. */
  context: AssistantContext;
  /** Current session's conversation turn list (oldest first). */
  turns: AssistantTurn[];
  /**
   * If turn mismatches current context (different screen), don't use as follow-up basis.
   * Omit to treat all turns as valid.
   */
  isStale?: (turn: AssistantTurn) => boolean;
  /** Max number to expose (default 4). */
  limit?: number;
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

/** Initial questions chosen by context alone (no conversation turn yet). */
function initialQuestions(context: AssistantContext): string[] {
  // D. Quality-specific only when Quality context "actually" exists.
  if (context.page === "quality" && (context.runId || context.datasetId)) {
    return [
      i18n.t("assistant.questions.q09"),
      i18n.t("assistant.questions.q10"),
      i18n.t("assistant.questions.q11"),
    ];
  }
  // Silver/Gold stage — columns/SQL.
  if (context.stage === "silver" || context.stage === "gold") {
    return [
      i18n.t("assistant.questions.q12"),
      i18n.t("assistant.questions.q13"),
      i18n.t("assistant.questions.q14"),
    ];
  }
  // C. Run/failure questions only when Run context exists.
  if (context.runId) {
    return [
      i18n.t("assistant.questions.q15"),
      i18n.t("assistant.questions.q16"),
      i18n.t("assistant.questions.q17"),
      i18n.t("assistant.questions.q18"),
    ];
  }
  // B. Dataset-specific only when Dataset context exists.
  if (context.datasetId) {
    return [
      i18n.t("assistant.questions.q19"),
      i18n.t("assistant.questions.q20"),
      i18n.t("assistant.questions.q21"),
      i18n.t("assistant.questions.q22"),
    ];
  }
  // A. No context at all.
  return START_QUESTIONS;
}

/** Most recent "answered" turn that doesn't mismatch current context. */
function lastAnsweredTurn(
  turns: AssistantTurn[],
  isStale?: (turn: AssistantTurn) => boolean,
): AssistantTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.status !== "ok" || !turn.response) continue;
    if (isStale && isStale(turn)) continue;
    return turn;
  }
  return undefined;
}

/** Follow-up questions chosen from recent turn's structured cues. */
function followUpQuestions(turn: AssistantTurn, context: AssistantContext): string[] {
  const response = turn.response;
  const evidence = turn.evidence;
  const out: string[] = [];

  if (response?.generatedSql) {
    out.push(
      i18n.t("assistant.questions.q23"),
      i18n.t("assistant.questions.q24"),
      i18n.t("assistant.questions.q25"),
    );
  }

  const quality = evidence?.quality;
  const hasQualityIssue =
    !!quality &&
    quality.availability !== "unavailable" &&
    quality.results.some((result) => result.status === "warn" || result.status === "fail");
  if (hasQualityIssue) {
    out.push(
      i18n.t("assistant.questions.q26"),
      i18n.t("assistant.questions.q27"),
    );
  }

  // Data exploration/recommendation nature — catalog evidence present or dataset/run not yet set.
  if (evidence?.catalog || (!context.datasetId && !context.runId)) {
    out.push(
      i18n.t("assistant.questions.q28"),
      i18n.t("assistant.questions.q29"),
      i18n.t("assistant.questions.q30"),
      i18n.t("assistant.questions.q31"),
    );
  }

  if (evidence?.dataset) {
    out.push(
      i18n.t("assistant.questions.q32"),
      i18n.t("assistant.questions.q33"),
    );
  }

  if (evidence?.stage || (evidence?.recentRuns?.length ?? 0) > 0 || context.runId) {
    out.push(
      i18n.t("assistant.questions.q34"),
      i18n.t("assistant.questions.q16"),
    );
  }

  // Structural cues insufficient — fallback to generic follow-up concretizing recent question.
  if (out.length === 0) {
    out.push(
      i18n.t("assistant.questions.q35"),
      i18n.t("assistant.questions.q36"),
      i18n.t("assistant.questions.q37"),
    );
  }

  return out;
}

/**
 * Choose next question candidates from current context and recent conversation.
 *
 * - If recent turn answered (and not stale), prioritize that conversation context.
 * - Otherwise, give initial recommendations by context (dataset/run/quality/stage).
 * - Result deduplicated and trimmed to `limit` (default 4).
 */
export function getSuggestedQuestions(input: SuggestedQuestionsInput): string[] {
  const { context, turns, isStale, limit = 4 } = input;

  const recent = lastAnsweredTurn(turns, isStale);
  const questions = recent
    ? followUpQuestions(recent, context)
    : initialQuestions(context);

  return dedupe(questions).slice(0, limit);
}
