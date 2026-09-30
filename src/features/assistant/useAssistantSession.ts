/**
 * Assistant conversation session (#256).
 *
 * `AssistantDrawer` and the `/assistant` page share this single hook —
 * don't create new assistant system, reuse existing `features/assistant` (BYOK provider/config,
 * scrubSecrets). Conversation turn state in zustand singleton store, so closing/opening drawer
 * (and navigating to `/assistant` page) continues same conversation.
 *
 * Stale guard (#256 review §6): Each turn captures `AssistantContext` at start and freezes it.
 * Past turns remain visible even after screen change (not overwritten), but side-effect operations
 * like SQL execution/Action apply only allowed when turn.context matches current route context.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { moveLegacyKey } from "@/shared/lib/storageMigration";
import { contextsMatch, resolveAssistantContext } from "./context";
import { buildAssistantDemoResponse, isAssistantDemoAvailable, runAssistantDemoQuery } from "./demo";
import { loadAssistantEvidence } from "./evidence";
import { buildAssistantMessages } from "./prompt";
import { parseAssistantResponse } from "./parseResponse";
import { crossCheckAssistantResponse } from "./crossCheck";
import { runAssistantQuery } from "./query";
import {
  actionHref,
  applyAddReportBlock,
  applyBuildSpecPatch as applyBuildSpecPatchAction,
  applyCreateBuildDraft,
  previewBuildSpecPatch,
} from "./actions";
import type { AssistantAction } from "./schema";
import type { AssistantActionRunState, AssistantContext, AssistantTurn } from "./types";
import { i18n } from "@/shared/i18n";

/**
 * All text strings in this file under `assistant.session.*` (#350).
 * Name not `t`: file has callbacks receiving `AssistantTurn` as `t`, obscures it.
 */
const msg = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`assistant.session.${key}`, params ?? {});

function newTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface AssistantStoreState {
  turns: AssistantTurn[];
  onboarded: boolean;
  addTurn: (turn: AssistantTurn) => void;
  updateTurn: (id: string, updater: (turn: AssistantTurn) => AssistantTurn) => void;
  setOnboarded: () => void;
  clearTurns: () => void;
  pendingSeed: string | null;
  seedQuestion: (question: string) => void;
  consumeSeed: () => string | null;
}

/** Assistant conversation state singleton. `onboarded` persisted; conversation content session-only (long-term save excluded). */
// The persisted store was `kpubdata-studio:kubi` before the rename (#450). Moved once so a
// returning visitor is not shown the onboarding again (#479).
moveLegacyKey("kpubdata-studio:kubi", "kpubdata-studio:assistant");

export const useAssistantStore = create<AssistantStoreState>()(
  persist(
    (set, get) => ({
      turns: [],
      onboarded: false,
      pendingSeed: null,
      addTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),
      updateTurn: (id, updater) =>
        set((state) => ({
          turns: state.turns.map((turn) => (turn.id === id ? updater(turn) : turn)),
        })),
      setOnboarded: () => set({ onboarded: true }),
      clearTurns: () => set({ turns: [] }),
      seedQuestion: (question) => set({ pendingSeed: question }),
      consumeSeed: () => {
        const seed = get().pendingSeed;
        set({ pendingSeed: null });
        return seed;
      },
    }),
    {
      name: "kpubdata-studio:assistant",
      partialize: (state) => ({ onboarded: state.onboarded }),
    },
  ),
);

export interface UseAssistantSessionResult {
  /** Route-derived current context at this moment. */
  liveContext: AssistantContext;
  pageLabel: string;
  onboarded: boolean;
  turns: AssistantTurn[];
  isConfigured: boolean;
  /** true only in mock Builder mode — tells UI whether `askDemo` can work when BYOK missing. */
  isDemoAvailable: boolean;
  ask: (question: string) => Promise<void>;
  /** Without BYOK/LLM, provide deterministic demo answer from mock evidence (`features/assistant/demo.ts`). */
  askDemo: (question: string) => Promise<void>;
  cancel: (turnId: string) => void;
  isStale: (turn: AssistantTurn) => boolean;
  executeQuery: (turnId: string) => Promise<void>;
  approveAction: (turnId: string, index: number) => Promise<void>;
  confirmApprovedAction: (turnId: string, index: number) => Promise<void>;
  rejectAction: (turnId: string, index: number) => void;
  previewPatch: (turnId: string, index: number) => ReturnType<typeof previewBuildSpecPatch> | null;
  goToAction: (action: AssistantAction) => void;
}

/**
 * Assistant conversation session hook. Single entry point shared by `AssistantDrawer`/`AssistantPage`.
 *
 * @returns Current route context, conversation turn list, question/cancel/execute/approve action functions.
 */
export function useAssistantSession(): UseAssistantSessionResult {
  const location = useLocation();
  const navigate = useNavigate();
  const { context: liveContext, pageLabel } = useMemo(
    () => resolveAssistantContext(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const turns = useAssistantStore((state) => state.turns);
  const onboarded = useAssistantStore((state) => state.onboarded);
  const addTurn = useAssistantStore((state) => state.addTurn);
  const updateTurn = useAssistantStore((state) => state.updateTurn);
  const setOnboarded = useAssistantStore((state) => state.setOnboarded);
  const pendingSeed = useAssistantStore((state) => state.pendingSeed);
  const consumeSeed = useAssistantStore((state) => state.consumeSeed);

  const { apiKey, model, baseUrl, baseUrlSafe, baseUrlError, isConfigured } = useAssistConfig();
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const isStale = useCallback((turn: AssistantTurn) => !contextsMatch(turn.context, liveContext), [liveContext]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      setOnboarded();

      const turnId = newTurnId();
      const context = liveContext;
      const turn: AssistantTurn = {
        id: turnId,
        question: trimmed,
        context,
        createdAt: new Date().toISOString(),
        status: "loading",
        phase: "collecting_evidence",
        query: { status: "idle" },
        actionStates: {},
      };
      addTurn(turn);

      if (!isConfigured) {
        updateTurn(turnId, (t) => ({ ...t, status: "error", error: { kind: "no_key" } }));
        return;
      }
      if (!baseUrlSafe) {
        updateTurn(turnId, (t) => ({
          ...t,
          status: "error",
          error: { kind: "bad_base_url", message: baseUrlError ?? msg("unsafeBaseUrl") },
        }));
        return;
      }

      const controller = new AbortController();
      controllersRef.current.set(turnId, controller);

      try {
        const { evidence, knownRefs, safeRunIds, safeEvidenceIds } = await loadAssistantEvidence(
          context,
          controller.signal,
        );
        updateTurn(turnId, (t) => ({ ...t, evidence }));

        updateTurn(turnId, (t) => ({ ...t, phase: "generating" }));

        const provider = createProvider({ apiKey, model, baseUrl });
        const messages = buildAssistantMessages(trimmed, evidence);
        let rawOutput = "";
        // LLM egress scrubber entropy false-positive exemption targets: Builder response confirmed exact
        // run ids (safeRunIds) + deterministically derived evidence identifiers from Builder `/quality` (safeEvidenceIds).
        // Ensures LLM echoes actual run/quality ids as-is and matches against crossCheck(knownRefs)/suggestedActions
        // normal evidence/action without removal, while unconfirmed route runId or arbitrary text stays entropy scrub target.
        for await (const chunk of provider.stream(messages, controller.signal, {
          safeRunIds: new Set<string>([...safeRunIds, ...safeEvidenceIds]),
        })) {
          rawOutput += chunk;
        }

        updateTurn(turnId, (t) => ({ ...t, phase: "validating" }));
        const parsed = parseAssistantResponse(rawOutput);
        if (!parsed.ok) {
          updateTurn(turnId, (t) => ({
            ...t,
            status: "error",
            rawOutput,
            error: { kind: "malformed_output", message: parsed.message },
          }));
          return;
        }

        const checked = crossCheckAssistantResponse(parsed.response, evidence, knownRefs);
        const actionStates: Record<number, AssistantActionRunState> = {};
        checked.response.suggestedActions.forEach((_, index) => {
          actionStates[index] = { status: "pending_approval" };
        });

        // Parse step malformed evidenceRefs (e.g., disallowed kind) also shown alongside cross-check removed evidence
        // in same place — answer preserved.
        const malformedRefs = parsed.malformedEvidenceRefs;
        const rejectedRefs = [
          ...malformedRefs.map((ref) => msg("excludedMalformed", { ref })),
          ...checked.rejectedRefs,
        ];
        const hasRejections =
          rejectedRefs.length > 0 || checked.rejectedActions.length > 0 || Boolean(checked.rejectedSqlReason);

        updateTurn(turnId, (t) => ({
          ...t,
          status: "ok",
          phase: undefined,
          rawOutput,
          response: checked.response,
          actionStates,
          error: hasRejections
            ? {
                kind: "hallucinated_refs",
                message: [
                  checked.rejectedSqlReason,
                  rejectedRefs.length ? msg("excludedRefs", { refs: rejectedRefs.join(", ") }) : null,
                  checked.rejectedActions.length
                    ? msg("excludedActions", { actions: checked.rejectedActions.join(", ") })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" "),
                rejectedRefs,
                rejectedActions: checked.rejectedActions,
              }
            : undefined,
        }));
      } catch (cause) {
        if (controller.signal.aborted) {
          updateTurn(turnId, (t) => ({ ...t, status: "error", error: { kind: "cancelled" } }));
          return;
        }
        updateTurn(turnId, (t) => ({
          ...t,
          status: "error",
          error: { kind: "llm_error", message: cause instanceof Error ? cause.message : msg("llmFailed") },
        }));
      } finally {
        controllersRef.current.delete(turnId);
      }
    },
    [liveContext, isConfigured, baseUrlSafe, baseUrlError, apiKey, model, baseUrl, addTurn, updateTurn, setOnboarded],
  );

  const askDemo = useCallback(
    async (question: string) => {
      if (!isAssistantDemoAvailable()) return;
      const trimmed = question.trim();
      if (!trimmed) return;
      setOnboarded();

      const turnId = newTurnId();
      const context = liveContext;
      const turn: AssistantTurn = {
        id: turnId,
        question: trimmed,
        context,
        createdAt: new Date().toISOString(),
        status: "loading",
        phase: "collecting_evidence",
        query: { status: "idle" },
        actionStates: {},
        isDemo: true,
      };
      addTurn(turn);

      const controller = new AbortController();
      controllersRef.current.set(turnId, controller);
      try {
        const { evidence } = await loadAssistantEvidence(context, controller.signal);
        updateTurn(turnId, (t) => ({ ...t, evidence, phase: "validating" }));
        const response = buildAssistantDemoResponse(evidence);
        updateTurn(turnId, (t) => ({ ...t, status: "ok", phase: undefined, evidence, response }));
      } catch (cause) {
        if (controller.signal.aborted) {
          updateTurn(turnId, (t) => ({ ...t, status: "error", error: { kind: "cancelled" } }));
          return;
        }
        updateTurn(turnId, (t) => ({
          ...t,
          status: "error",
          error: { kind: "llm_error", message: cause instanceof Error ? cause.message : msg("demoEvidenceFailed") },
        }));
      } finally {
        controllersRef.current.delete(turnId);
      }
    },
    [liveContext, addTurn, updateTurn, setOnboarded],
  );

  const cancel = useCallback((turnId: string) => {
    controllersRef.current.get(turnId)?.abort();
  }, []);

  const executeQuery = useCallback(
    async (turnId: string) => {
      const turn = turns.find((t) => t.id === turnId);
      const sql = turn?.response?.generatedSql;
      if (!turn || !sql) return;
      if (!contextsMatch(turn.context, liveContext)) {
        updateTurn(turnId, (t) => ({
          ...t,
          query: { status: "error", code: "invalid_context", message: msg("contextChangedSql") },
        }));
        return;
      }
      updateTurn(turnId, (t) => ({ ...t, query: { status: "running" } }));

      // Demo turn doesn't call Builder `/query` — shows fixed mock result (#256 demo).
      if (turn.isDemo) {
        const result = await runAssistantDemoQuery();
        updateTurn(turnId, (t) => ({ ...t, query: result }));
        return;
      }

      const controller = new AbortController();
      controllersRef.current.set(`${turnId}:query`, controller);
      const result = await runAssistantQuery(turn.context, sql, controller.signal);
      controllersRef.current.delete(`${turnId}:query`);
      updateTurn(turnId, (t) => ({ ...t, query: result }));
    },
    [turns, liveContext, updateTurn],
  );

  const setActionState = useCallback(
    (turnId: string, index: number, state: AssistantActionRunState) => {
      updateTurn(turnId, (t) => ({ ...t, actionStates: { ...t.actionStates, [index]: state } }));
    },
    [updateTurn],
  );

  const goToAction = useCallback(
    (action: AssistantAction) => {
      const href = actionHref(action);
      if (href) navigate(href);
    },
    [navigate],
  );

  // OPEN_* / ADD_REPORT_BLOCK apply immediately with single approve. PATCH_BUILDSPEC/CREATE_BUILD_DRAFT
  // show diff/preview first, so transition to "approved" state only; actual apply done by confirmApprovedAction.
  const approveAction = useCallback(
    async (turnId: string, index: number) => {
      const turn = turns.find((t) => t.id === turnId);
      const action = turn?.response?.suggestedActions[index];
      if (!turn || !action) return;
      if (!contextsMatch(turn.context, liveContext)) {
        setActionState(turnId, index, { status: "error", message: msg("contextChangedAction") });
        return;
      }

      if (action.type === "PATCH_BUILDSPEC" || action.type === "CREATE_BUILD_DRAFT") {
        setActionState(turnId, index, { status: "approved" });
        return;
      }

      setActionState(turnId, index, { status: "applying" });
      try {
        if (action.type === "OPEN_PROVIDER" || action.type === "OPEN_BUILD" || action.type === "OPEN_QUALITY") {
          goToAction(action);
          setActionState(turnId, index, { status: "applied", message: msg("opened") });
        } else if (action.type === "ADD_REPORT_BLOCK") {
          applyAddReportBlock(action, turn.context);
          setActionState(turnId, index, { status: "applied", message: msg("addedToReport") });
        }
      } catch (cause) {
        setActionState(turnId, index, {
          status: "error",
          message: cause instanceof Error ? cause.message : msg("actionFailed"),
        });
      }
    },
    [turns, liveContext, setActionState, goToAction],
  );

  const previewPatch = useCallback(
    (turnId: string, index: number) => {
      const turn = turns.find((t) => t.id === turnId);
      const action = turn?.response?.suggestedActions[index];
      if (!action || action.type !== "PATCH_BUILDSPEC") return null;
      return previewBuildSpecPatch(action);
    },
    [turns],
  );

  const confirmApprovedAction = useCallback(
    async (turnId: string, index: number) => {
      const turn = turns.find((t) => t.id === turnId);
      const action = turn?.response?.suggestedActions[index];
      if (!turn || !action) return;
      if (!contextsMatch(turn.context, liveContext)) {
        setActionState(turnId, index, { status: "error", message: msg("contextChangedApply") });
        return;
      }

      setActionState(turnId, index, { status: "applying" });

      if (action.type === "PATCH_BUILDSPEC") {
        const preview = previewBuildSpecPatch(action);
        if (!preview.ok) {
          setActionState(turnId, index, { status: "error", message: preview.reason });
          return;
        }
        try {
          const result = await applyBuildSpecPatchAction(action.runId, preview.after);
          setActionState(turnId, index, {
            status: "applied",
            message: result.valid
              ? msg("patchApplied")
              : msg("patchAppliedInvalid", { errors: result.errors.join("; ") }),
          });
        } catch (cause) {
          setActionState(turnId, index, {
            status: "error",
            message: cause instanceof Error ? cause.message : msg("patchFailed"),
          });
        }
        return;
      }

      if (action.type === "CREATE_BUILD_DRAFT") {
        try {
          applyCreateBuildDraft(action);
          setActionState(turnId, index, { status: "applied", message: msg("draftSaved") });
          navigate("/add");
        } catch (cause) {
          setActionState(turnId, index, {
            status: "error",
            message: cause instanceof Error ? cause.message : msg("draftSaveFailed"),
          });
        }
      }
    },
    [turns, liveContext, setActionState, navigate],
  );

  const rejectAction = useCallback(
    (turnId: string, index: number) => {
      setActionState(turnId, index, { status: "rejected", reason: msg("actionRejected") });
    },
    [setActionState],
  );

  // A screen (Run detail, Quality, …) left a seeded question for consumption. AssistantDrawer and `/assistant` page may mount
  // simultaneously (both use this hook); atomic pop from consumeSeed() ensures ask() called exactly once —
  // prevents same question executing twice.
  useEffect(() => {
    if (!pendingSeed) return;
    const seed = consumeSeed();
    if (seed) void ask(seed);
  }, [pendingSeed, consumeSeed, ask]);

  return {
    liveContext,
    pageLabel,
    onboarded,
    turns,
    isConfigured,
    isDemoAvailable: isAssistantDemoAvailable(),
    ask,
    askDemo,
    cancel,
    isStale,
    executeQuery,
    approveAction,
    confirmApprovedAction,
    rejectAction,
    previewPatch,
    goToAction,
  };
}
