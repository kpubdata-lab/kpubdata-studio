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
 * Initial questions to show when Dataset/Run/Quality context missing (Home hero, empty /assistant).
 * Does not include Quality/Build failure/SQL questions.
 *
 * These are translation keys, not text (#978): the locale chunks load after this module is
 * evaluated, and the reader can switch language at any time, so text is looked up only when
 * the questions are asked for.
 */
const START_QUESTION_KEYS = [
  "assistant.questions.q01",
  "assistant.questions.q02",
  "assistant.questions.q03",
  "assistant.questions.q04",
];

/** Initial questions in the current language. */
export function getStartQuestions(): string[] {
  return translateQuestions(START_QUESTION_KEYS, (key) => i18n.t(key));
}

/**
 * Translates question keys, dropping any key the loaded locale does not have: a key
 * identifier is never shown, and never sent as a question.
 */
function translateQuestions(keys: string[], translate: (key: string) => string): string[] {
  return keys.filter((key) => i18n.exists(key)).map((key) => translate(key));
}

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
  /**
   * Translates a question key. Pass the component's `t` so the questions follow a language
   * change; defaults to the i18n instance's current language.
   */
  translate?: (key: string) => string;
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

/** Initial question keys chosen by context alone (no conversation turn yet). */
function initialQuestions(context: AssistantContext): string[] {
  // D. Quality-specific only when Quality context "actually" exists.
  if (context.page === "quality" && (context.runId || context.datasetId)) {
    return [
      "assistant.questions.q09",
      "assistant.questions.q10",
      "assistant.questions.q11",
    ];
  }
  // Silver/Gold stage — columns/SQL.
  if (context.stage === "silver" || context.stage === "gold") {
    return [
      "assistant.questions.q12",
      "assistant.questions.q13",
      "assistant.questions.q14",
    ];
  }
  // C. Run/failure questions only when Run context exists.
  if (context.runId) {
    return [
      "assistant.questions.q15",
      "assistant.questions.q16",
      "assistant.questions.q17",
      "assistant.questions.q18",
    ];
  }
  // B. Dataset-specific only when Dataset context exists.
  if (context.datasetId) {
    return [
      "assistant.questions.q19",
      "assistant.questions.q20",
      "assistant.questions.q21",
      "assistant.questions.q22",
    ];
  }
  // A. No context at all.
  return START_QUESTION_KEYS;
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

/** Follow-up question keys chosen from recent turn's structured cues. */
function followUpQuestions(turn: AssistantTurn, context: AssistantContext): string[] {
  const response = turn.response;
  const evidence = turn.evidence;
  const out: string[] = [];

  if (response?.generatedSql) {
    out.push(
      "assistant.questions.q23",
      "assistant.questions.q24",
      "assistant.questions.q25",
    );
  }

  const quality = evidence?.quality;
  const hasQualityIssue =
    !!quality &&
    quality.availability !== "unavailable" &&
    quality.results.some((result) => result.status === "warn" || result.status === "fail");
  if (hasQualityIssue) {
    out.push(
      "assistant.questions.q26",
      "assistant.questions.q27",
    );
  }

  // Data exploration/recommendation nature — catalog evidence present or dataset/run not yet set.
  if (evidence?.catalog || (!context.datasetId && !context.runId)) {
    out.push(
      "assistant.questions.q28",
      "assistant.questions.q29",
      "assistant.questions.q30",
      "assistant.questions.q31",
    );
  }

  if (evidence?.dataset) {
    out.push(
      "assistant.questions.q32",
      "assistant.questions.q33",
    );
  }

  if (evidence?.stage || (evidence?.recentRuns?.length ?? 0) > 0 || context.runId) {
    out.push(
      "assistant.questions.q34",
      "assistant.questions.q16",
    );
  }

  // Structural cues insufficient — fallback to generic follow-up concretizing recent question.
  if (out.length === 0) {
    out.push(
      "assistant.questions.q35",
      "assistant.questions.q36",
      "assistant.questions.q37",
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
  const { context, turns, isStale, limit = 4, translate = (key: string) => i18n.t(key) } = input;

  const recent = lastAnsweredTurn(turns, isStale);
  const questions = recent
    ? followUpQuestions(recent, context)
    : initialQuestions(context);

  return translateQuestions(dedupe(questions), translate).slice(0, limit);
}
