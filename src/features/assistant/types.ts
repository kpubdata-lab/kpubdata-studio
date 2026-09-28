/**
 * Assistant shared types (#256).
 *
 * Collect the `AssistantContext` shape fixed by issue #256 and the evidence/structured response/action/
 * conversation turn types operating on it in one place. Since UI·evidence·prompt·cross-check·action
 * modules share only this file's types, only edit here when changing the shape.
 */
import type { QueryResponse } from "@/shared/lib/builderApi";
import type { AssistantAction } from "./schema";

/** stage that Assistant handles in context. */
export type AssistantStage = "bronze" | "silver" | "gold";

/**
 * Assistant context contract fixed by issue #256.
 *
 * Adding/deleting fields impacts route resolver·stale guard·evidence·prompt, so extend
 * this shape only within the bounds of issue design.
 */
export interface AssistantContext {
  page: string;
  datasetId?: string;
  runId?: string;
  stage?: AssistantStage;
   /**
    * Builder canonical source_key selected on screen (`?source=` query convention, #253/#254).
    * Determines which source to query for stage evidence in multi-source runs — if not in route,
    * leave as undefined and do not infer (same identity as P5 canonical source policy).
    * Field name is `source` — to avoid `redactSecrets` secret-named heuristic (`*key$`).
    */
  source?: string;
  qualityResultIds?: string[];
  provider?: string;
}

/** Synthetic ID uniquely identifying a specific quality result. Builder response has no id. */
export function qualityResultRefId(result: {
  source_key: string;
  category: string;
  rule: string;
  column: string | null;
}): string {
  return `${result.source_key}::${result.category}::${result.rule}::${result.column ?? "_"}`;
}

/** Canonical evidence ID identifying stage detail confirmed by Builder. */
export function stageEvidenceRefId(runId: string, source: string, stage: AssistantStage): string {
  return `${runId}::${source}::${stage}`;
}

/** Individual evidence type that can fail during evidence queries. */
export type AssistantEvidenceSource = "dataset" | "runs" | "stage" | "quality" | "catalog" | "spec";

/** Summary of quality result included in Evidence (synthetic ID added to original QualityCheckResult). */
export interface AssistantQualityResultEvidence {
  id: string;
   /** Builder canonical source_key. If field name is `sourceKey`, redactSecrets marks `[REDACTED]` (`*key$`). */
  source: string;
  category: string;
  rule: string;
  column: string | null;
  status: "pass" | "warn" | "fail";
  actual: unknown;
  threshold: unknown;
  detail: string | null;
}

/** Safe evidence bundle sent to LLM. Contains no secrets or original credentials. */
export interface AssistantEvidence {
  fetchedAt: string;
  context: AssistantContext;
  dataset?: {
    datasetId: string;
    title: string;
    providers: string[];
     /** Provider+source dataset name pairs. Used to exclude "self" when calculating related dataset candidates. */
    sources: { provider: string; dataset: string }[];
    latestRunId: string;
    status: string;
    updatedAt: string | null;
    totalRowCount: number;
  };
  recentRuns?: { runId: string; status: string; startedAt: string | null; finishedAt: string | null }[];
  stage?: {
     /** Canonical evidence ref derived from exact run/source/stage identity. */
    refId: string;
    stage: AssistantStage;
    /** Builder canonical source_key. If field name is `sourceKey`, redactSecrets marks it `[REDACTED]` (`*key$`). */
    source: string;
    status: string;
    available: boolean;
    rowCount: number | null;
     /**
      * Exact column names of this stage output (as returned by Builder stage detail).
      * Expose so generated SQL cannot guess/abbreviate/transform column names — silver uses schema[].name,
      * gold uses columns field. Undefined for bronze or when available=false.
      * Never add column names from user questions or model output (evidence principle).
      */
    columns?: string[];
      /**
       * dtype per column (provided only from Builder silver stage detail schema — gold stage detail
       * gives only names without dtype). When numeric aggregation target column is String, used as basis
       * to guide prompt to use TRY_CAST instead of strict CAST. Undefined if absent.
       */
    schema?: { name: string; dtype: string }[];
  };
  quality?: {
    availability: "available" | "partial" | "unavailable";
    evaluatedChecks: number;
    results: AssistantQualityResultEvidence[];
    schemaDrift: { kind: string; column: string | null; detail: string }[];
  };
  catalog?: {
    providers: string[];
    datasetsByProvider: Record<string, string[]>;
  };
  buildSpecSummary?: {
    title: string;
    description: string;
    // kind="file"/"url" sources (#498) have no provider/dataset — filled with public_api only.
    sources: { provider?: string; dataset?: string; alias?: string; paramKeys: string[] }[];
    exportFormats: string[];
    metadataKeys: string[];
  };
  deepLinks: {
    datasetDetail?: string;
    qualityCenter?: string;
    buildDetail?: string;
  };
  /** Whether partial evidence queries failed. If true, response must not claim full confirmation. */
  partial: boolean;
  /** List of evidence types that failed retrieval (exposed as-is to user). */
  unavailable: AssistantEvidenceSource[];
}

/** Sole reference targets inside evidence (known ID set used for existence validation). */
export interface AssistantKnownRefs {
  datasetIds: Set<string>;
  runIds: Set<string>;
  /** dataset_id + run_id membership pairs directly confirmed by Builder dataset detail/run-list. */
  datasetRunMemberships: Set<string>;
  providers: Set<string>;
  qualityResultIds: Set<string>;
  schemaDriftIds: Set<string>;
  /** Contains only canonical refs whose existence was confirmed via Builder stage detail in this evidence load. */
  stageIds: Set<string>;
   /**
    * Set of Builder canonical source_keys ("provider.dataset") that actually appear in evidence.
    * Collected from quality results and stage evidence. If generated SQL's `source` is not in this set,
    * it's unvalidated and not sent directly to Builder `/query` (crossCheck).
    */
  sourceKeys: Set<string>;
}

/** Serializes dataset/run pair as conflict-free trust set key. */
export function datasetRunMembershipRef(datasetId: string, runId: string): string {
  return JSON.stringify([datasetId, runId]);
}

/** Evidence citation in LLM structured response. */
export interface AssistantEvidenceRef {
  kind: "dataset" | "run" | "stage" | "quality" | "schema_drift" | "catalog";
  id: string;
  label: string;
}

/** Generated SQL produced by LLM (not auto-executed — user must explicitly execute). */
export interface AssistantGeneratedSql {
  sql: string;
  stage: "silver" | "gold";
  source?: string;
}

/** Structured response that passed Zod validation and evidence/catalog cross-checks. */
export interface AssistantStructuredResponse {
  answer: string;
  evidenceRefs: AssistantEvidenceRef[];
  generatedSql: AssistantGeneratedSql | null;
  suggestedActions: AssistantAction[];
}

/** Ways a single Q&A turn can fail. Shown as-is to user in transmitted state. */
export type AssistantErrorState =
  | { kind: "no_key" }
  | { kind: "bad_base_url"; message: string }
  | { kind: "llm_error"; message: string }
  | { kind: "cancelled" }
  | { kind: "malformed_output"; message: string }
  | { kind: "hallucinated_refs"; message: string; rejectedRefs: string[]; rejectedActions: string[] }
  | { kind: "stale_context" };

/** Generated SQL execute(Builder `/query`) result state. */
export type AssistantQueryState =
  | { status: "idle" }
  | { status: "blocked"; reason: string }
  | { status: "running" }
  | { status: "success"; result: QueryResponse }
  | {
      status: "error";
      code:
        | "unsafe_query"
        | "forbidden"
        | "artifact_unavailable"
        | "invalid_context"
        | "invalid_request"
        | "query_busy"
        | "query_timeout"
        | "query_execution_failed"
        | "network"
        | "mock_mode"
        | "unknown";
      message: string;
    };

/** Action approve/execute state. */
export type AssistantActionRunState =
  | { status: "pending_approval" }
  | { status: "approved" }
  | { status: "applying" }
  | { status: "applied"; message: string }
  | { status: "rejected"; reason: string }
  | { status: "error"; message: string };

/** Current step in actual request pipeline. Mock timer transitions only at await boundaries. */
export type AssistantTurnPhase = "collecting_evidence" | "generating" | "validating";

/** Single question/turn. Context is captured at request start (stale guard). */
export interface AssistantTurn {
  id: string;
  question: string;
   /** Context at turn start — value does not change even if route changes later. */
  context: AssistantContext;
  createdAt: string;
  status: "loading" | "ok" | "error";
  phase?: AssistantTurnPhase;
  evidence?: AssistantEvidence;
  response?: AssistantStructuredResponse;
  error?: AssistantErrorState;
  rawOutput?: string;
  query: AssistantQueryState;
  actionStates: Record<number, AssistantActionRunState>;
   /**
    * true if this turn is mock demo (doesn't call actual LLM/Builder `/query`) — see `features/assistant/demo.ts`.
    * Mock Builder mode shows evidence→response→generated SQL flow without BYOK; UI must check this value
    * and always show demo indicator to avoid confusion with "real results".
    */
  isDemo?: boolean;
}

/**
 * Convert quality results from evidence to short summary for context bar/demo response.
 * If no rules evaluated or query failed, return "—" (N/A) — don't fabricate PASS/0%.
 */
export function summarizeAssistantQuality(quality: AssistantEvidence["quality"]): string {
  if (!quality || quality.availability === "unavailable") return "—";
  const failCount = quality.results.filter((result) => result.status === "fail").length;
  if (failCount > 0) return `${failCount} FAIL`;
  const warnCount = quality.results.filter((result) => result.status === "warn").length;
  if (warnCount > 0) return `${warnCount} WARN`;
  if (quality.evaluatedChecks > 0) return "PASS";
  return "—";
}
