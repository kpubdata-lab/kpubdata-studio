/**
 * Kubi mock/dev demo (follow-up to #256 review — "seems different from the current prototype").
 *
 * A deterministic demo path that lets you see Kubi's evidence → structured response → generated SQL →
 * result preview flow in mock Builder mode without a BYOK API key. It does not call a real LLM
 * nor the actual Builder `/query` — it deterministically assembles fixed text using only the mock
 * evidence already provided by `features/datasets/api` (reusing #256 evidence.ts).
 *
 * **Does not pretend to be real results**: every turn created by this module is marked with
 * `KubiTurn.isDemo = true` and the first line of the answer notes it is a demo. The UI should always
 *
 * In real mode (`VITE_USE_REAL_BUILDER=true`) this module is not used — the flow goes
 * BYOK → real LLM (`features/assistant/provider`) → Builder `/query` (`features/kubi/query.ts`).
 * continues the same flow.
 */
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { QueryResponse } from "@/shared/lib/builderApi";
import type { KubiAction } from "./schema";
import { summarizeKubiQuality } from "./types";
import type { KubiEvidence, KubiQueryState, KubiStructuredResponse } from "./types";
import { i18n } from "@/shared/i18n";

/** The phrases used in this file also exist under all `kubi.demo.*` keys (#350). */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`kubi.demo.${key}`, params ?? {});

/** Whether a demo can be provided: only in mock Builder mode (default). Real mode always requires BYOK. */
export function isKubiDemoAvailable(): boolean {
  return !isRealBuilderEnabled();
}

const demoDisclaimer = (): string => t("disclaimer");

/**
 * Builds a deterministic structured response based only on actually fetched (mock) evidence. Because it
 * does not call an LLM, it cannot cite ids missing from the evidence — making it safe without a
 *
 * @param evidence - evidence returned by `loadKubiEvidence` (the demo uses the same mock data path).
 */
export function buildKubiDemoResponse(evidence: KubiEvidence): KubiStructuredResponse {
  const lines: string[] = [demoDisclaimer()];
  const evidenceRefs: KubiStructuredResponse["evidenceRefs"] = [];
  const suggestedActions: KubiAction[] = [];

  if (evidence.dataset) {
    lines.push(
      t("datasetStatus", {
        title: evidence.dataset.title,
        datasetId: evidence.dataset.datasetId,
        status: evidence.dataset.status,
      }),
    );
    evidenceRefs.push({ kind: "dataset", id: evidence.dataset.datasetId, label: evidence.dataset.title });

    const runId = evidence.context.runId ?? evidence.dataset.latestRunId;
    suggestedActions.push({
      type: "OPEN_QUALITY",
      datasetId: evidence.dataset.datasetId,
      runId,
      reason: t("qualityReason"),
    });
    suggestedActions.push({
      type: "ADD_REPORT_BLOCK",
      note: t("demoNote", { title: evidence.dataset.title }),
      reason: t("reportReason"),
    });
  } else {
    lines.push(t("noDataset"));
  }

  if (evidence.quality) {
    const summary = summarizeKubiQuality(evidence.quality);
    lines.push(summary === "—" ? t("noQuality") : t("qualitySummary", { summary }));
    const firstResult = evidence.quality.results[0];
    if (firstResult) {
      evidenceRefs.push({ kind: "quality", id: firstResult.id, label: `${firstResult.category}/${firstResult.rule}` });
    }
  }

  let generatedSql: KubiStructuredResponse["generatedSql"] = null;
  if (evidence.stage && (evidence.context.stage === "silver" || evidence.context.stage === "gold")) {
    generatedSql = {
       // Builder #504 contract: SQL must query only the logical relation "dataset" — the real source_key
       // is not used as the FROM table name but is passed separately via the generatedSql.source field (query.ts attaches it to the /query request).
      sql: `SELECT region, COUNT(*) AS count FROM dataset GROUP BY region`,
      stage: evidence.context.stage,
      source: evidence.stage.source,
    };
    evidenceRefs.push({
      kind: "stage",
      id: evidence.stage.refId,
      label: `${evidence.stage.source} · ${evidence.stage.stage}`,
    });
    lines.push(t("sqlNote"));
  } else if (evidence.dataset) {
    lines.push(t("stageHint"));
  }

  return { answer: lines.join("\n"), evidenceRefs, generatedSql, suggestedActions };
}

 /** Shown fixed mock result when the demo generated SQL (`SELECT region, COUNT(*) ... GROUP BY region`) is executed. */
const DEMO_QUERY_RESULT: QueryResponse = {
  columns: ["region", "count"],
  rows: [
    { region: "서울", count: 123 },
    { region: "부산", count: 98 },
    { region: "인천", count: 41 },
  ],
  truncated: false,
  execution_ms: 8,
};

/**
 * Executes generated SQL for a demo turn — returns a fixed mock result immediately without calling the Builder `/query`
 * (unlike `runKubiQuery` in features/kubi/query.ts; not used in real mode).
 */
export async function runKubiDemoQuery(): Promise<KubiQueryState> {
  return { status: "success", result: DEMO_QUERY_RESULT };
}
