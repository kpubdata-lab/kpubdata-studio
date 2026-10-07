/**
 * Assistant conversation UI (#256).
 *
 * `AssistantDrawer` (global drawer) and `/assistant` dedicated page share this single component — don't create
 * a second Assistant system. `compact` differs only layout between drawer (narrow) and page (wide);
 * all state logic lives in `useAssistantSession`.
 */
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cellValue, encodingsOf, type WireEncoding } from "@/shared/lib/cellValue";
import { SpecDiff } from "@/features/build-spec/components/SpecDiff";
import { MaskedCell, MaskedColumnBadge, maskedSet } from "@/features/data-table/masked";
import { useAssistConfig } from "@/features/assistant/config";
import { Button, Card, Disclosure, TermHelp, Textarea } from "@/shared/ui";
import { describeAction } from "./actions";
import { relatedCatalogDatasets } from "./relatedDatasets";
import type { AssistantAction } from "./schema";
import { getSuggestedQuestions } from "./suggestedQuestions";
import { summarizeAssistantQuality } from "./types";
import type { AssistantActionRunState, AssistantContext, AssistantErrorState, AssistantQueryState, AssistantTurn } from "./types";
import { useAssistantSession } from "./useAssistantSession";
import { MarkdownContent } from "./MarkdownContent";
import type { AssistantEvidenceRef } from "./types";
import { formatSqlForDisplay } from "./formatSqlForDisplay";
import { useLiveRunSources } from "./useLiveRunSources";

/** Demo CTA and onboarding example use the same default question (works with mock evidence only). */
const getDemoQuestion = () => i18n.t("assistant.empty.demoQuestion");

/**
 * Prototype structure (DATASET/BUILD(RUN)/STAGE/QUALITY 4-cell) context bar (#256 review).
 * PAGE was not a separate grid cell in prototype but a helper caption in drawer header, so display
 * here also as small single-line caption — does not take up 4 cells.
 */
function ContextBar({ context, pageLabel, qualityLabel, sources, onContextChange }: { context: AssistantContext; pageLabel: string; qualityLabel: string; sources: string[]; onContextChange: (key: "stage" | "source", value?: string) => void }) {
  const { t } = useTranslation();
  const cells: { label: string; value: string }[] = [
    { label: t("labels.table"), value: context.datasetId ?? "—" },
    { label: t("labels.run"), value: context.runId ?? "—" },
    { label: t("labels.quality"), value: qualityLabel },
  ];
  // Stage evidence query requires run to exist, and for multi-source runs source must be determined
  // (if source not selected, evidence loader fails-closed stage — evidence.ts). Single-source
  // run has Builder automatically select the unique source, so Stage works even if source not selected.
  const stageSelectDisabled = !context.runId || (sources.length > 1 && !context.source);
  return (
    <div>
      <p className="mb-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">{t("assistant.context.current")} · {pageLabel}<TermHelp term="context" /></p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-lg border border-border bg-muted/40 px-2.5 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{cell.label}</p>
            <p className="mt-0.5 truncate text-xs font-medium text-foreground" title={cell.value}>
              {cell.value}
            </p>
          </div>
        ))}
        <label className="rounded-lg border border-border bg-muted/40 px-2.5 py-2"><span className="block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t("labels.stage")}</span><select aria-label={t("assistant.context.stageAria")} className="mt-0.5 w-full bg-transparent text-xs font-medium" value={context.stage ?? ""} onChange={(event) => onContextChange("stage", event.target.value || undefined)} disabled={stageSelectDisabled}><option value="">{context.runId ? t("assistant.context.stageAll") : t("assistant.context.stageDisabled")}</option><option value="bronze">Bronze</option><option value="silver">Silver</option><option value="gold">Gold</option></select></label>
      </div>
      {context.runId && sources.length > 1 ? <label className="mt-2 block text-xs text-muted-foreground">{t("assistant.context.sourceLabel")}<select aria-label={t("assistant.context.sourceAria")} className="ml-2 rounded border border-input bg-card px-2 py-1 text-foreground" value={context.source ?? ""} onChange={(event) => onContextChange("source", event.target.value || undefined)}><option value="">{t("assistant.context.sourceFirst")}</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label> : null}
      <p className="mt-2 text-[11px] text-muted-foreground">{!context.runId ? t("assistant.context.hintNoRun") : sources.length > 1 && !context.source ? t("assistant.context.hintMultiSource") : !context.stage ? t("assistant.context.hintNoStage") : context.stage === "bronze" ? t("assistant.context.hintBronze") : t("assistant.context.hintSqlReady", { stage: context.stage === "gold" ? "Gold" : "Silver" })}</p>
    </div>
  );
}

/**
 * BYOK (API Key/Model/Base URL) config form. `AssistantContent` (exposed by default when BYOK not set) and
 * `AssistantReportPanel` (#258 — exposed only when "AI Settings" clicked) share this single component.
 * Don't create new BYOK storage/security semantics — reuse `useAssistConfig` as-is.
 */
export function ApiKeySetup() {
  const { t } = useTranslation();
  const { apiKey, model, baseUrl, isDefaultBaseUrl, baseUrlSafe, baseUrlError, persistToStorage, setConfig, enablePersistence, disablePersistence } =
    useAssistConfig();
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftModel, setDraftModel] = useState(model);
  const [draftBaseUrl, setDraftBaseUrl] = useState(baseUrl);

  return (
    <Card variant="dashed" className="space-y-3 p-4">
      <div>
        <p className="text-sm font-semibold">{t("assistant.byok.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("assistant.byok.desc")}
        </p>
      </div>
      <label className="block text-xs font-medium text-muted-foreground">
        {t("labels.apiKey")}
        <input
          type="password"
          className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
          value={draftKey}
          onChange={(event) => setDraftKey(event.target.value)}
          placeholder="sk-..."
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-muted-foreground">
          {t("assistant.byok.modelLabel")}
          <input
            className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            value={draftModel}
            onChange={(event) => setDraftModel(event.target.value)}
            placeholder="gpt-4o-mini"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          {t("assistant.byok.baseUrlLabel")}
          <input
            className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            value={draftBaseUrl}
            onChange={(event) => setDraftBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>
      </div>
      {!isDefaultBaseUrl ? (
        <p className="text-xs text-status-warning" role="alert">
          {t("assistant.byok.baseUrlWarning")} <code>{draftBaseUrl || baseUrl}</code>
        </p>
      ) : null}
      {!baseUrlSafe && baseUrlError ? (
        <p className="text-xs text-status-failure" role="alert">
          {baseUrlError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setConfig({ apiKey: draftKey, model: draftModel, baseUrl: draftBaseUrl })} disabled={!draftKey.trim()}>
          {t("assistant.byok.saveSession")}
        </Button>
        {persistToStorage ? (
          <Button size="sm" variant="secondary" onClick={disablePersistence}>
            {t("assistant.byok.clearStored")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={enablePersistence} disabled={!draftKey.trim()}>
            {t("assistant.byok.saveBrowser")}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function ErrorNotice({ error, onRetry }: { error: AssistantErrorState; onRetry?: () => void }) {
  const { t } = useTranslation();
  const message: Record<AssistantErrorState["kind"], string> = {
    no_key: "assistant.turnStatus.noKey",
    bad_base_url: (error as Extract<AssistantErrorState, { kind: "bad_base_url" }>).message,
    llm_error: (error as Extract<AssistantErrorState, { kind: "llm_error" }>).message,
    cancelled: "assistant.turnStatus.cancelled",
    malformed_output: (error as Extract<AssistantErrorState, { kind: "malformed_output" }>).message,
    hallucinated_refs: (error as Extract<AssistantErrorState, { kind: "hallucinated_refs" }>).message,
    stale_context: "assistant.turnStatus.staleContext",
  };
  return (
    <div role="alert" className="rounded-lg border border-status-failure-border bg-status-failure-subtle px-3 py-2 text-xs text-status-failure">
      {message[error.kind]}
      {onRetry ? (
        <Button className="ml-2" size="sm" variant="ghost" onClick={onRetry}>
          {t("assistant.turnStatus.retry")}
        </Button>
      ) : null}
    </div>
  );
}

const QUERY_ERROR_LABEL: Record<string, string> = {
  unsafe_query: "assistant.queryError.unsafe_query",
  forbidden: "assistant.queryError.forbidden",
  artifact_unavailable: "assistant.queryError.artifact_unavailable",
  invalid_context: "assistant.queryError.invalid_context",
  invalid_request: "assistant.queryError.invalid_request",
  query_busy: "assistant.queryError.query_busy",
  query_timeout: "assistant.queryError.query_timeout",
  query_execution_failed: "assistant.queryError.query_execution_failed",
  query_resource_limit: "assistant.queryError.query_resource_limit",
  // Policy blocks, not failures (#640): the same words as the SQL workspace.
  redistribution_forbidden: "sql.blocked.redistribution_forbidden.title",
  declared_pii_withheld: "sql.blocked.declared_pii_withheld.title",
  pii_declaration_unavailable: "sql.blocked.pii_declaration_unavailable.title",
  network: "assistant.queryError.network",
  mock_mode: "assistant.queryError.mock_mode",
  unknown: "assistant.queryError.unknown",
};

/**
 * Convert `/query` row value to display string (#256 review §1).
 *
 * null/undefined become "—" as before; primitives like string/number/boolean shown as-is.
 * array/object: String() produces "[object Object]", so use JSON.stringify to show actual
 * content — never summarize or transform the value itself.
 */
export function formatQueryValue(value: unknown, encoding?: WireEncoding): string {
  return cellValue(encoding, value);
}

export function QueryResultView({ query }: { query: AssistantQueryState }) {
  const { t } = useTranslation();
  if (query.status === "idle") return null;
  if (query.status === "blocked") {
    return <p className="mt-2 text-xs text-muted-foreground">{query.reason}</p>;
  }
  if (query.status === "running") {
    return <p className="mt-2 text-xs text-muted-foreground">{t("assistant.query.running")}</p>;
  }
  if (query.status === "error") {
    return (
      <p role="alert" className="mt-2 text-xs text-status-failure">
        {QUERY_ERROR_LABEL[query.code] ? t(QUERY_ERROR_LABEL[query.code]) : query.message} ({query.message})
      </p>
    );
  }
  const { columns, rows, truncated, execution_ms } = query.result;
  const encodings = encodingsOf(query.result.column_meta);
  // Declared PII Builder masked on a Silver query (builder#900, #641).
  const masked = maskedSet(query.result.masked_columns);
  return (
    <div className="mt-2 space-y-1.5">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-2.5 py-1.5 font-semibold">
                  <span className="block">{column}</span>
                  {masked.has(column) ? <MaskedColumnBadge /> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                {columns.map((column) => (
                  <td key={column} className="px-2.5 py-1.5">
                    {masked.has(column) ? (
                      <MaskedCell fallback={formatQueryValue(row[column], encodings.get(column))} value={row[column]} />
                    ) : (
                      formatQueryValue(row[column], encodings.get(column))
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("assistant.query.rowsShown", { rows: rows.length, scope: truncated ? t("assistant.query.truncated") : t("assistant.query.all"), ms: execution_ms })}
      </p>
    </div>
  );
}

function ActionCard({
  turn,
  action,
  index,
  isStale,
  session,
}: {
  turn: AssistantTurn;
  action: AssistantAction;
  index: number;
  isStale: boolean;
  session: ReturnType<typeof useAssistantSession>;
}) {
  const { t } = useTranslation();
  const state: AssistantActionRunState = turn.actionStates[index] ?? { status: "pending_approval" };
  const isNavigation = action.type === "OPEN_BUILD" || action.type === "OPEN_QUALITY" || action.type === "OPEN_PROVIDER";

  return (
    <div className={isNavigation ? "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs" : "rounded-lg border border-border bg-card px-3 py-2 text-xs"}>
      <div className={isNavigation ? "min-w-0" : undefined}>
      {action.type === "PATCH_BUILDSPEC" ? (
        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-assistant-accent-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-assistant-accent-text">
          {t("assistant.action.buildSpec")}
        </span>
      ) : null}
      <p className="font-medium text-foreground">{describeAction(action)}</p>
      <p className="mt-0.5 text-muted-foreground">{action.reason}</p>

      </div>

      {action.type === "ADD_REPORT_BLOCK" ? (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("assistant.action.reportNote")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{action.note}</p>
          {turn.response && turn.response.evidenceRefs.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("assistant.action.evidence")} <TermHelp term="evidence" />
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {turn.response.evidenceRefs.map((ref) => (
                  <li
                    key={`${ref.kind}:${ref.id}`}
                    className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px]"
                  >
                    {ref.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.status === "approved" && action.type === "PATCH_BUILDSPEC" ? (
        (() => {
          const preview = session.previewPatch(turn.id, index);
          if (!preview) return null;
          if (!preview.ok) return <p className="mt-2 text-status-failure">{preview.reason}</p>;
          return (
            <div className="mt-2 rounded-lg border border-border p-2">
              <SpecDiff before={preview.before} after={preview.after} />
            </div>
          );
        })()
      ) : null}
      {state.status === "approved" && action.type === "CREATE_BUILD_DRAFT" ? (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/50 p-2 text-[11px]">
          {JSON.stringify(action.values, null, 2)}
        </pre>
      ) : null}

      <div className={`${isNavigation ? "" : "mt-2"} flex flex-wrap items-center gap-2`}>
        {state.status === "pending_approval" ? (
          <>
            <Button size="sm" aria-label={isNavigation ? t("assistant.content.approve") : undefined} disabled={isStale} onClick={() => session.approveAction(turn.id, index)}>
              {isNavigation ? t("assistant.action.open") : t("assistant.action.approve")}
            </Button>
            <Button className={isNavigation ? "sr-only" : undefined} size="sm" variant="ghost" onClick={() => session.rejectAction(turn.id, index)}>
              {t("assistant.action.reject")}
            </Button>
          </>
        ) : null}
        {state.status === "approved" ? (
          <Button size="sm" disabled={isStale} onClick={() => session.confirmApprovedAction(turn.id, index)}>
            {t("assistant.action.apply")}
          </Button>
        ) : null}
        {state.status === "applying" ? <span className="text-muted-foreground">{t("assistant.action.applying")}</span> : null}
        {state.status === "applied" ? <span className="text-status-success">{state.message}</span> : null}
        {state.status === "rejected" ? <span className="text-muted-foreground">{t("assistant.action.rejected")}</span> : null}
        {state.status === "error" ? <span className="text-status-failure">{state.message}</span> : null}
        {isStale && (state.status === "pending_approval" || state.status === "approved") ? (
          <span className="text-status-warning">{t("assistant.action.staleCantRun")}</span>
        ) : null}
      </div>
    </div>
  );
}

export function evidenceDetail(turn: AssistantTurn, ref: AssistantEvidenceRef) {
  const evidence = turn.evidence;
  if (!evidence) return null;
  if (ref.kind === "quality") return evidence.quality?.results.find((item) => item.id === ref.id) ?? null;
  if (ref.kind === "schema_drift") return evidence.quality?.schemaDrift.find((item) => `${item.kind}::${item.column ?? "_"}` === ref.id) ?? null;
  if (ref.kind === "dataset" && evidence.dataset?.datasetId === ref.id) return evidence.dataset;
  if (ref.kind === "run") return evidence.recentRuns?.find((item) => item.runId === ref.id) ?? (turn.context.runId === ref.id ? { runId: ref.id } : null);
  if (ref.kind === "stage" && evidence.stage?.refId === ref.id) return evidence.stage;
  if (ref.kind === "catalog" && evidence.catalog) return evidence.catalog;
  return null;
}

export function evidenceDetailEntries(turn: AssistantTurn, ref: AssistantEvidenceRef): [string, string][] {
  const detail = evidenceDetail(turn, ref);
  if (!detail) return [];
  if (ref.kind === "stage" && turn.evidence?.stage) {
    const stage = turn.evidence.stage;
    return [
      ["Stage", stage.stage[0].toUpperCase() + stage.stage.slice(1)],
      ["Source", stage.source],
      ["Status", stage.status],
      ["Rows", stage.rowCount === null ? "—" : String(stage.rowCount)],
      ...(stage.columns ? [["Columns", String(stage.columns.length)] as [string, string]] : []),
    ];
  }
  return Object.entries(detail)
    .filter(([, value]) => value !== undefined && typeof value !== "object")
    .map(([key, value]) => [key, String(value ?? "—")]);
}

export function evidenceHref(turn: AssistantTurn, ref: AssistantEvidenceRef): string | null {
  const detail = evidenceDetail(turn, ref);
  if (!detail) return null;
  if (ref.kind === "dataset") return turn.evidence?.deepLinks.datasetDetail ?? null;
  if (ref.kind === "run") {
    if (!("runId" in detail) || typeof detail.runId !== "string") return null;
    const targetRunId = detail.runId;
    const params = new URLSearchParams({ run: targetRunId });
    if (turn.context.datasetId) params.set("dataset", turn.context.datasetId);
    // source/stage valid only when context is validated in that run. Moving to different recent run —
    // carrying current run's selection creates non-existent combination, so don't pass together.
    if (targetRunId === turn.context.runId) {
      if (turn.context.source) params.set("source", turn.context.source);
      if (turn.context.stage) params.set("stage", turn.context.stage);
    }
    return `/refresh-jobs?${params}`;
  }
  if (ref.kind === "stage") {
    if (!turn.context.runId) return null;
    const params = new URLSearchParams({ run: turn.context.runId });
    if (turn.context.datasetId) params.set("dataset", turn.context.datasetId);
    if (turn.context.source) params.set("source", turn.context.source);
    if (turn.context.stage) params.set("stage", turn.context.stage);
    return `/refresh-jobs?${params}`;
  }
  if (ref.kind === "quality" || ref.kind === "schema_drift") {
    if (!turn.context.runId && !turn.context.datasetId) return null;
    const params = new URLSearchParams();
    if (turn.context.datasetId) params.set("dataset", turn.context.datasetId);
    if (turn.context.runId) params.set("run", turn.context.runId);
    if ("source" in detail && typeof detail.source === "string") params.set("source", detail.source);
    else if (turn.context.source) params.set("source", turn.context.source);
    if (turn.context.stage) params.set("stage", turn.context.stage);
    return `/quality?${params}`;
  }
  return null;
}

export function EvidenceSection({ turn }: { turn: AssistantTurn }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<AssistantEvidenceRef | null>(null);
  const refs = turn.response?.evidenceRefs ?? [];
  const rejected = turn.error?.kind === "hallucinated_refs" ? turn.error.rejectedRefs : [];
  if (!refs.length && !rejected.length && !turn.evidence?.partial) return null;
  const detail = selected ? evidenceDetail(turn, selected) : null;
  const detailEntries = selected ? evidenceDetailEntries(turn, selected) : [];
  const href = selected ? evidenceHref(turn, selected) : null;
  return <Disclosure title={rejected.length ? t("assistant.evidence.countRejected", { count: refs.length, rejected: rejected.length }) : t("assistant.evidence.count", { count: refs.length })}>
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">{refs.map((ref) => <button key={`${ref.kind}:${ref.id}`} type="button" aria-pressed={selected?.kind === ref.kind && selected.id === ref.id} onClick={() => setSelected(ref)} className="rounded-full border border-border bg-muted/40 px-2 py-1 text-[10px] hover:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{ref.label}</button>)}</div>
      {selected ? <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <p className="font-semibold">{selected.label}</p>
        {detail ? <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{detailEntries.map(([key, value]) => <div className="contents" key={key}><dt className="text-muted-foreground">{key}</dt><dd className="break-all">{value}</dd></div>)}</dl> : <p className="mt-1 text-muted-foreground">{t("assistant.evidence.detailUnavailable")}</p>}
        {href ? <Link className="mt-2 inline-block font-medium underline" to={href}>{t("assistant.evidence.openOriginal")}</Link> : null}
      </div> : null}
      {rejected.length ? <Disclosure title={t("assistant.evidence.rejectedCount", { count: rejected.length })}>{<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{rejected.map((item) => <li key={item}>{item}</li>)}</ul>}</Disclosure> : null}
      {turn.evidence?.partial ? <p className="text-[11px] text-muted-foreground">{t("assistant.evidence.unavailable", { items: turn.evidence.unavailable.join(", ") })}</p> : null}
    </div>
  </Disclosure>;
}

function LoadingPhase({ turn }: { turn: AssistantTurn }) {
  const { t } = useTranslation();
  const steps = [
    ["collecting_evidence", "assistant.phases.collecting"],
    ["generating", "assistant.phases.generating"],
    ["validating", "assistant.phases.validating"],
  ] as const;
  const current = steps.findIndex(([phase]) => phase === turn.phase);
  return <div aria-live="polite" className="space-y-1 text-muted-foreground">{steps.map(([phase, label], index) => <p key={phase}>{index < current ? "✓" : index === current ? "●" : "○"} {label}{index === current ? t("assistant.phases.inProgress") : ""}</p>)}</div>;
}

function TurnCard({ turn, session, collapsed = false, onToggle }: { turn: AssistantTurn; session: ReturnType<typeof useAssistantSession>; collapsed?: boolean; onToggle?: () => void }) {
  const { t } = useTranslation();
  const stale = session.isStale(turn);

  if (collapsed) return <button type="button" aria-expanded="false" onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-muted"><span>{turn.status === "ok" ? t("assistant.turn.ok") : turn.status === "error" ? t("assistant.turn.error") : t("assistant.turn.running")}</span><span className="truncate font-medium">{turn.question}</span>{stale ? <span className="ml-auto shrink-0 text-status-warning">{t("assistant.turn.stale")}</span> : null}</button>;

  return (
    <div className="space-y-2">
      {onToggle ? <div className="flex justify-end"><button type="button" aria-expanded="true" onClick={onToggle} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">{t("assistant.turn.collapse")}</button></div> : null}
      <div className="ml-auto max-w-[88%] rounded-lg bg-brand-primary px-3 py-2 text-xs text-brand-primary-foreground">
        {turn.question}
      </div>

      <div className="max-w-[92%] rounded-lg border border-border bg-card px-3 py-2 text-xs">
        {turn.isDemo ? (
          <p className="mb-1.5 mr-1.5 inline-block rounded-full bg-assistant-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-assistant-accent-text">
            {t("assistant.turn.demoBadge")}
          </p>
        ) : null}
        {stale ? (
          <p className="mb-1.5 inline-block rounded-full bg-status-warning-subtle px-2 py-0.5 text-[10px] font-semibold text-status-warning">
            {t("assistant.turn.staleBadge")}
          </p>
        ) : null}

        {turn.status === "loading" ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoadingPhase turn={turn} />
            <Button size="sm" variant="ghost" onClick={() => session.cancel(turn.id)}>
              {t("assistant.turn.cancel")}
            </Button>
          </div>
        ) : null}

        {turn.status === "error" && turn.error ? <ErrorNotice error={turn.error} /> : null}

        {turn.response ? (
          <div className="space-y-2.5">
            <MarkdownContent>{turn.response.answer}</MarkdownContent>

            {turn.error?.kind === "hallucinated_refs" ? (
              <p role="alert" className="text-[11px] text-status-warning">
                {turn.error.message}
              </p>
            ) : null}

            <EvidenceSection turn={turn} />

            {turn.response.generatedSql ? (
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2"><p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("assistant.query.generatedSql")} · {turn.response.generatedSql.stage}<TermHelp term="generatedSql" /></p><Button size="sm" variant="ghost" aria-label={t("assistant.query.copySql")} onClick={() => void navigator.clipboard?.writeText(turn.response!.generatedSql!.sql).catch(() => {})}>{t("assistant.query.copy")}</Button></div>
                <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre rounded-lg bg-muted/70 p-2 font-mono text-[11px]">{formatSqlForDisplay(turn.response.generatedSql.sql)}</pre>
                <Button
                  size="sm"
                  className="mt-1.5"
                  disabled={stale || turn.query.status === "running"}
                  onClick={() => session.executeQuery(turn.id)}
                >
                  {turn.query.status === "running" ? t("assistant.query.runningEllipsis") : t("assistant.query.run")}
                </Button>
                <QueryResultView query={turn.query} />
              </div>
            ) : null}

            {turn.response.suggestedActions.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("assistant.query.suggestedActions")}</p>
                <div className="mt-1 space-y-1.5">
                  {turn.response.suggestedActions.map((action, index) => (
                    <ActionCard key={index} turn={turn} action={action} index={index} isStale={stale} session={session} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface AssistantContentProps {
  compact?: boolean;
}

/** Assistant conversation screen. Shared between drawer/page. */
export function AssistantContent({ compact = false }: AssistantContentProps) {
  const { t } = useTranslation();
  const session = useAssistantSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { isConfigured } = useAssistConfig();
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openPastTurns, setOpenPastTurns] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  // Without BYOK, mock mode allows demo questions (#256 demo; real mode always needs BYOK).
  const canSubmit = isConfigured || session.isDemoAvailable;

  // Context bar QUALITY cell: filled only from most recent turn's evidence that matches current context (not stale).
  // Can't determine quality from route alone, so if evidence not yet available, don't fabricate — show "—".
  const qualityLabel = useMemo(() => {
    for (let i = session.turns.length - 1; i >= 0; i -= 1) {
      const turn = session.turns[i];
      if (turn.evidence && !session.isStale(turn)) return summarizeAssistantQuality(turn.evidence.quality);
    }
    return "—";
  }, [session.turns, session.isStale]);

  // "Related dataset" candidates: not LLM but only actual catalog evidence from most recent non-stale turn
  // (#256 issue checklist, relatedDatasets.ts). If no turn yet (=evidence not retrieved),
  // keep empty array and explain reason below — don't infer and fill.
  const relatedDatasets = useMemo(() => {
    for (let i = session.turns.length - 1; i >= 0; i -= 1) {
      const turn = session.turns[i];
      if (turn.evidence && !session.isStale(turn)) return relatedCatalogDatasets(turn.evidence);
    }
    return [];
  }, [session.turns, session.isStale]);

  // Even before first question, authoritatively use current Run's Builder-confirmed stage source list.
  // Past turn/LLM/quality results don't inform live source candidates.
  const contextSources = useLiveRunSources(session.liveContext.runId);

  // Suggested questions chosen deterministically from current context and recent conversation (no extra LLM call,
  // suggestedQuestions.ts). Updated immediately when turns change (after first question etc.).
  const suggestedQuestions = useMemo(
    () =>
      getSuggestedQuestions({
        context: session.liveContext,
        turns: session.turns,
        isStale: session.isStale,
      }),
    [session.liveContext, session.turns, session.isStale],
  );

  function changeContext(key: "stage" | "source", value?: string) {
    const params = new URLSearchParams(location.search);
    if (value) params.set(key, value); else params.delete(key);
    if (key === "source") params.delete("stage");
    navigate(`${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  useEffect(() => { latestRef.current?.scrollIntoView?.({ block: "start" }); }, [session.turns.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [input]);

  function submit(question: string) {
    setInput("");
    if (!isConfigured && session.isDemoAvailable) {
      void session.askDemo(question);
      return;
    }
    void session.ask(question);
  }

  return (
    <div className={compact ? "flex h-full min-h-0 flex-col" : "grid gap-4 lg:grid-cols-[1fr_280px]"}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={compact ? "shrink-0 border-b border-border px-5 py-3" : "mb-4"}><ContextBar context={session.liveContext} pageLabel={session.pageLabel} qualityLabel={qualityLabel} sources={contextSources} onContextChange={changeContext} /></div>

        <div className={compact ? "min-h-0 flex-1 overflow-y-auto px-5 py-4" : "space-y-4"} data-testid="assistant-conversation">

        {!isConfigured ? (
          <div className="space-y-3">
            <ApiKeySetup />
            {session.isDemoAvailable ? (
              <Card variant="dashed" className="space-y-2 p-4">
                <p className="text-sm font-semibold">{t("assistant.empty.demoTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("assistant.empty.demoDesc")}
                </p>
                <Button size="sm" variant="secondary" onClick={() => submit(getDemoQuestion())}>
                  {t("assistant.empty.demoSend")}
                </Button>
              </Card>
            ) : null}
          </div>
        ) : null}

        {session.turns.length === 0 && !session.onboarded ? (
          <Card className="space-y-2 border-dashed p-4">
            <p className="text-sm font-semibold">{t("assistant.empty.welcomeTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("assistant.empty.welcomeDesc")}</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-brand-primary hover:text-foreground"
                  onClick={() => submit(question)}
                  disabled={!canSubmit}
                >
                  {question}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {session.turns.length > 1 ? <div className="mb-3"><button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} className="text-xs font-semibold text-muted-foreground">{historyOpen ? "▼" : "▶"} {t("assistant.turn.history", { count: session.turns.length - 1 })}</button>{historyOpen ? <div className="mt-2 space-y-2">{session.turns.slice(0, -1).map((turn) => <TurnCard key={turn.id} turn={turn} session={session} collapsed={!openPastTurns.has(turn.id)} onToggle={() => setOpenPastTurns((current) => { const next = new Set(current); if (next.has(turn.id)) next.delete(turn.id); else next.add(turn.id); return next; })} />)}</div> : null}</div> : null}
        {session.turns.length ? <div ref={latestRef}><TurnCard turn={session.turns[session.turns.length - 1]} session={session} /></div> : null}
        </div>

        <form
          className={compact ? "flex shrink-0 items-end gap-2 border-t border-border bg-card px-5 py-3" : "mt-4 flex items-end gap-2"}
          onSubmit={(event) => {
            event.preventDefault();
            if (input.trim()) submit(input);
          }}
        >
          <Textarea
            ref={textareaRef}
            rows={2}
            aria-label={t("assistant.input.aria")}
            className="max-h-36 min-h-[4.25rem] flex-1 resize-none overflow-y-auto"
            disabled={!canSubmit}
            onChange={(event) => setInput(event.target.value)}
            placeholder={isConfigured ? t("assistant.input.placeholder") : canSubmit ? t("assistant.input.placeholderDemo") : t("assistant.input.placeholderNoKey")}
            value={input}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !composingRef.current && !event.nativeEvent.isComposing) { event.preventDefault(); if (input.trim()) submit(input); } }}
          />
          <Button type="submit" disabled={!canSubmit || !input.trim()}>
            {t("assistant.input.send")}
          </Button>
        </form>
      </div>

      {!compact ? (
        <Card className="h-fit space-y-3 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("assistant.input.suggested")}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestedQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-brand-primary hover:text-foreground"
                  onClick={() => submit(question)}
                  disabled={!canSubmit}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
          {session.liveContext.datasetId ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("assistant.input.currentDataset")}</p>
              <Link
                className="mt-1 block text-xs font-medium text-brand-text underline"
                to={`/tables/${encodeURIComponent(session.liveContext.datasetId)}`}
              >
                {t("assistant.input.openDataset", { id: session.liveContext.datasetId })}
              </Link>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("assistant.input.relatedDatasets")}</p>
            {relatedDatasets.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {relatedDatasets.map((candidate) => (
                  <li
                    key={`${candidate.provider}::${candidate.dataset}`}
                    className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5 text-xs last:border-0 last:pb-0"
                  >
                    <span className="truncate text-muted-foreground" title={candidate.dataset}>
                      {candidate.dataset}
                    </span>
                    <span className="shrink-0 font-medium text-foreground">{candidate.provider}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {session.liveContext.datasetId
                  ? t("assistant.input.relatedHintNoQ")
                  : t("assistant.input.relatedHintNoDs")}
              </p>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
