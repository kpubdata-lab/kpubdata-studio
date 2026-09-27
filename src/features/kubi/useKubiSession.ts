/**
 * Kubi conversation session (#256).
 *
 * `KubiDrawer`, `/kubi` page, and top `KubiSearchInput` all share this single hook —
 * don't create new assistant system, reuse existing `features/assistant` (BYOK provider/config,
 * scrubSecrets). Conversation turn state in zustand singleton store, so closing/opening drawer
 * (and navigating to `/kubi` page) continues same conversation.
 *
 * Stale guard (#256 review §6): Each turn captures `KubiContext` at start and freezes it.
 * Past turns remain visible even after screen change (not overwritten), but side-effect operations
 * like SQL execution/Action apply only allowed when turn.context matches current route context.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { contextsMatch, resolveKubiContext } from "./context";
import { buildKubiDemoResponse, isKubiDemoAvailable, runKubiDemoQuery } from "./demo";
import { loadKubiEvidence } from "./evidence";
import { buildKubiMessages } from "./prompt";
import { parseKubiResponse } from "./parseResponse";
import { crossCheckKubiResponse } from "./crossCheck";
import { runKubiQuery } from "./query";
import {
  actionHref,
  applyAddReportBlock,
  applyBuildSpecPatch as applyBuildSpecPatchAction,
  applyCreateBuildDraft,
  previewBuildSpecPatch,
} from "./actions";
import type { KubiAction } from "./schema";
import type { KubiActionRunState, KubiContext, KubiTurn } from "./types";
import { i18n } from "@/shared/i18n";

/**
 * All text strings in this file under `kubi.session.*` (#350).
 * Name not `t`: file has callbacks receiving `KubiTurn` as `t`, obscures it.
 */
const msg = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`kubi.session.${key}`, params ?? {});

function newTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface KubiStoreState {
  turns: KubiTurn[];
  onboarded: boolean;
  addTurn: (turn: KubiTurn) => void;
  updateTurn: (id: string, updater: (turn: KubiTurn) => KubiTurn) => void;
  setOnboarded: () => void;
  clearTurns: () => void;
  pendingSeed: string | null;
  seedQuestion: (question: string) => void;
  consumeSeed: () => string | null;
}

/** Kubi conversation state singleton. `onboarded` persisted; conversation content session-only (long-term save excluded). */
export const useKubiStore = create<KubiStoreState>()(
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
      name: "kpubdata-studio:kubi",
      partialize: (state) => ({ onboarded: state.onboarded }),
    },
  ),
);

export interface UseKubiSessionResult {
  /** Route-derived current context at this moment. */
  liveContext: KubiContext;
  pageLabel: string;
  onboarded: boolean;
  turns: KubiTurn[];
  isConfigured: boolean;
  /** true only in mock Builder mode — tells UI whether `askDemo` can work when BYOK missing. */
  isDemoAvailable: boolean;
  ask: (question: string) => Promise<void>;
  /** Without BYOK/LLM, provide deterministic demo answer from mock evidence (`features/kubi/demo.ts`). */
  askDemo: (question: string) => Promise<void>;
  cancel: (turnId: string) => void;
  isStale: (turn: KubiTurn) => boolean;
  executeQuery: (turnId: string) => Promise<void>;
  approveAction: (turnId: string, index: number) => Promise<void>;
  confirmApprovedAction: (turnId: string, index: number) => Promise<void>;
  rejectAction: (turnId: string, index: number) => void;
  previewPatch: (turnId: string, index: number) => ReturnType<typeof previewBuildSpecPatch> | null;
  goToAction: (action: KubiAction) => void;
}

/**
 * Kubi conversation session hook. Single entry point shared by `KubiDrawer`/`KubiPage`.
 *
 * @returns Current route context, conversation turn list, question/cancel/execute/approve action functions.
 */
export function useKubiSession(): UseKubiSessionResult {
  const location = useLocation();
  const navigate = useNavigate();
  const { context: liveContext, pageLabel } = useMemo(
    () => resolveKubiContext(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const turns = useKubiStore((state) => state.turns);
  const onboarded = useKubiStore((state) => state.onboarded);
  const addTurn = useKubiStore((state) => state.addTurn);
  const updateTurn = useKubiStore((state) => state.updateTurn);
  const setOnboarded = useKubiStore((state) => state.setOnboarded);
  const pendingSeed = useKubiStore((state) => state.pendingSeed);
  const consumeSeed = useKubiStore((state) => state.consumeSeed);

  const { apiKey, model, baseUrl, baseUrlSafe, baseUrlError, isConfigured } = useAssistConfig();
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const isStale = useCallback((turn: KubiTurn) => !contextsMatch(turn.context, liveContext), [liveContext]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      setOnboarded();

      const turnId = newTurnId();
      const context = liveContext;
      const turn: KubiTurn = {
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
        const { evidence, knownRefs, safeRunIds, safeEvidenceIds } = await loadKubiEvidence(
          context,
          controller.signal,
        );
        updateTurn(turnId, (t) => ({ ...t, evidence }));

        updateTurn(turnId, (t) => ({ ...t, phase: "generating" }));

        const provider = createProvider({ apiKey, model, baseUrl });
        const messages = buildKubiMessages(trimmed, evidence);
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
        const parsed = parseKubiResponse(rawOutput);
        if (!parsed.ok) {
          updateTurn(turnId, (t) => ({
            ...t,
            status: "error",
            rawOutput,
            error: { kind: "malformed_output", message: parsed.message },
          }));
          return;
        }

        const checked = crossCheckKubiResponse(parsed.response, evidence, knownRefs);
        const actionStates: Record<number, KubiActionRunState> = {};
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
      if (!isKubiDemoAvailable()) return;
      const trimmed = question.trim();
      if (!trimmed) return;
      setOnboarded();

      const turnId = newTurnId();
      const context = liveContext;
      const turn: KubiTurn = {
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
        const { evidence } = await loadKubiEvidence(context, controller.signal);
        updateTurn(turnId, (t) => ({ ...t, evidence, phase: "validating" }));
        const response = buildKubiDemoResponse(evidence);
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
        const result = await runKubiDemoQuery();
        updateTurn(turnId, (t) => ({ ...t, query: result }));
        return;
      }

      const controller = new AbortController();
      controllersRef.current.set(`${turnId}:query`, controller);
      const result = await runKubiQuery(turn.context, sql, controller.signal);
      controllersRef.current.delete(`${turnId}:query`);
      updateTurn(turnId, (t) => ({ ...t, query: result }));
    },
    [turns, liveContext, updateTurn],
  );

  const setActionState = useCallback(
    (turnId: string, index: number, state: KubiActionRunState) => {
      updateTurn(turnId, (t) => ({ ...t, actionStates: { ...t.actionStates, [index]: state } }));
    },
    [updateTurn],
  );

  const goToAction = useCallback(
    (action: KubiAction) => {
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
          navigate("/builds/new");
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

  // Top search bar (KubiSearchInput) left question for consumption. KubiDrawer and `/kubi` page may mount
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
    isDemoAvailable: isKubiDemoAvailable(),
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
