/**
 * Report editor page (`/reports/:reportId`, #258).
 *
 * Opens one saved Report Draft to read, edit, and export as Markdown/HTML/Print the
 * document (sections 1–6: Builder evidence summary, 7: Assistant analysis, 8: user notes).
 * Also refreshes baseline evidence or approves Assistant reference notes for reflection.
 *
 * IA (#258 IA redesign, Prototype SSOT `report-layout`): on desktop, left side shows
 * the actual report document and right side shows a Report Context sidebar displaying
 * only values that exist in this Report — 2-column layout. On narrow viewports, the
 * sidebar collapses below the document (`grid-cols-1` → `lg:grid-cols-[minmax(0,1fr)_320px]`).
 *
 * All edit actions save immediately (autosave) — so actions like "Refresh Evidence"
 * can safely replace deterministic blocks without losing unsaved user edits
 * (#258 §9 minimal safety model).
 */
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildDeterministicSections } from "@/features/reports/deterministicSections";
import { buildEvidenceRefs, fetchReportEvidence } from "@/features/reports/evidence";
import { downloadHtml, downloadMarkdown } from "@/features/reports/export";
import { buildSectionSummaries } from "@/features/reports/narrativeSummary";
import { createReport, getReport, saveReport } from "@/features/reports/repository";
import { checkReportEvidenceStatus, type EvidenceStalenessResult } from "@/features/reports/staleness";
import type {
  BuilderEvidenceBlock,
  BuilderEvidenceSection,
  AssistantInterpretationBlock,
  ReportDraft,
  UserContentBlock,
} from "@/features/reports/types";
import { BlockView } from "@/features/reports/components/BlockView";
import { AssistantInboxPanel } from "@/features/reports/components/AssistantInboxPanel";
import { AssistantReportPanel } from "@/features/reports/components/AssistantReportPanel";
import { ReportContextSidebar } from "@/features/reports/components/ReportContextSidebar";
import { UserContentEditor } from "@/features/reports/components/UserContentEditor";
import { listAssistantReportNotes } from "@/features/assistant/reportInbox";
import { Button, Card, EmptyState, ErrorState, PageHeader, TextInput } from "@/shared/ui";

function newBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `user-${crypto.randomUUID()}`;
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ReportEditorPage() {
  const { t } = useTranslation();
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<ReportDraft | null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const [staleness, setStaleness] = useState<EvidenceStalenessResult | null>(null);
  const [stalenessLoading, setStalenessLoading] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [addingUserBlock, setAddingUserBlock] = useState(false);
  const [editingUserBlockId, setEditingUserBlockId] = useState<string | null>(null);

  const [titleDraft, setTitleDraft] = useState("");
  const [pendingAssistantNoteCount, setPendingAssistantNoteCount] = useState(0);

   // legacy summary (#258 legacy summary fix): BUILDER_EVIDENCE blocks saved before
   // `summary` was added lack this field. Rather than arbitrarily migrating the saved
   // draft itself, we enrich only the display — if evidence re-fetch fails, this stays
   // null and we show the table as before.
  const [legacySummaries, setLegacySummaries] = useState<Record<BuilderEvidenceSection, string> | null>(null);

  useEffect(() => {
    if (!reportId) {
      setReport(null);
      return;
    }
    const loaded = getReport(reportId);
    setReport(loaded);
    setTitleDraft(loaded?.title ?? "");
  }, [reportId]);

  const refreshPendingAssistantNoteCount = useCallback(() => {
    setPendingAssistantNoteCount(listAssistantReportNotes().length);
  }, []);

  useEffect(() => {
    refreshPendingAssistantNoteCount();
  }, [refreshPendingAssistantNoteCount]);

  const runStalenessCheck = useCallback((current: ReportDraft, signal?: AbortSignal) => {
    setStalenessLoading(true);
    checkReportEvidenceStatus(current.datasetId, current.baseRunId, signal)
      .then((result) => {
        if (signal?.aborted) return;
        setStaleness(result);
      })
      .finally(() => {
        if (!signal?.aborted) setStalenessLoading(false);
      });
  }, []);

  const loadedReportId = report?.id;
  useEffect(() => {
    if (!report) return;
    const controller = new AbortController();
    runStalenessCheck(report, controller.signal);
    return () => controller.abort();
     // Check again only when report.id changes (no need to re-check when the same
     // report object reference updates). report/runStalenessCheck themselves may get
     // new references each render, so intentionally omit from dependencies. This check
     // only judges staleness, never changes baseRunId (#258 §8 invariant) — even if
     // STALE, a separate Report is created only when user explicitly clicks "Create
     // from Latest Run".
  }, [loadedReportId]);

  useEffect(() => {
    if (!report) return;
    const hasLegacyBlock = report.blocks.some(
      (block) => block.provenance === "BUILDER_EVIDENCE" && !block.summary,
    );
    if (!hasLegacyBlock) {
      setLegacySummaries(null);
      return;
    }
    const controller = new AbortController();
    fetchReportEvidence(report.datasetId, report.baseRunId, controller.signal)
      .then((evidence) => {
        if (controller.signal.aborted) return;
        setLegacySummaries(buildSectionSummaries(evidence));
      })
       .catch(() => {
         // Failed to re-fetch evidence — keep the saved draft as-is (legacy table without
         // summary). Don't break the entire Report due to summary generation failure
         // (#258 legacy summary §1).
       });
    return () => controller.abort();
     // Recalculate only when report.id changes — same reason as staleness check above:
     // exclude report object reference itself from dependencies (e.g., changing title
     // doesn't trigger re-fetch).
  }, [loadedReportId]);

  function persist(next: ReportDraft) {
    const result = saveReport(next);
    if (!result.ok) {
      setSaveError(result.reason);
      return false;
    }
    const saved = { ...next, revision: result.revision };
    setReport(saved);
    setSaveError(null);
    setLastSavedAt(new Date().toISOString());
    return true;
  }

  function handleTitleBlur() {
    if (!report) return;
    const trimmed = titleDraft.trim() || t("reportEditor.untitled");
    if (trimmed === report.title) return;
    persist({ ...report, title: trimmed });
  }

  function handleAddUserBlock(heading: string, markdown: string) {
    if (!report) return;
    const now = new Date().toISOString();
    const block: UserContentBlock = {
      id: newBlockId(),
      provenance: "USER_CONTENT",
      heading,
      markdown,
      createdAt: now,
      updatedAt: now,
    };
    persist({ ...report, blocks: [...report.blocks, block] });
    setAddingUserBlock(false);
  }

  function handleEditUserBlock(id: string, heading: string, markdown: string) {
    if (!report) return;
    const now = new Date().toISOString();
    persist({
      ...report,
      blocks: report.blocks.map((block) =>
        block.id === id && block.provenance === "USER_CONTENT" ? { ...block, heading, markdown, updatedAt: now } : block,
      ),
    });
    setEditingUserBlockId(null);
  }

  function handleDeleteUserBlock(id: string) {
    if (!report) return;
    if (!window.confirm(t("reportEditor.deleteBlockConfirm"))) return;
    persist({ ...report, blocks: report.blocks.filter((block) => block.id !== id) });
  }

  function handleRemoveAssistantBlock(id: string) {
    if (!report) return;
    persist({ ...report, blocks: report.blocks.filter((block) => block.id !== id) });
  }

  function handleApproveAssistantBlock(block: AssistantInterpretationBlock) {
    if (!report) return;
    persist({ ...report, blocks: [...report.blocks, block] });
  }

  async function handleRefreshEvidence() {
    if (!report) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const evidence = await fetchReportEvidence(report.datasetId, report.baseRunId);
      const nextEvidenceBlocks = buildDeterministicSections(evidence);
      const evidenceRefs = buildEvidenceRefs(evidence);
       // Only replace deterministic (BUILDER_EVIDENCE) blocks with newly generated ones;
       // keep Assistant/user blocks as-is (#258 §9 — separate auto-generated and user-authored
       // areas to preserve user edits).
      const keptBlocks = report.blocks.filter((block) => block.provenance !== "BUILDER_EVIDENCE");
      const nextReport: ReportDraft = {
        ...report,
        evidenceFetchedAt: evidence.fetchedAt,
        buildSpecDigest: evidence.run.ok ? evidence.run.value.spec_digest : report.buildSpecDigest,
        blocks: [...nextEvidenceBlocks, ...keptBlocks],
        evidenceRefs,
      };
      persist(nextReport);
      runStalenessCheck(nextReport);
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : t("reportEditor.refreshError"));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreateFromLatest() {
    if (!report || !staleness?.latestRunId) return;
    try {
      const evidence = await fetchReportEvidence(report.datasetId, staleness.latestRunId);
      const blocks = buildDeterministicSections(evidence);
      const evidenceRefs = buildEvidenceRefs(evidence);
      const datasetTitle = evidence.dataset.ok ? evidence.dataset.value.title : report.datasetId;
      const { report: created, result } = createReport({
        title: t("reportEditor.newReportTitle", { dataset: datasetTitle, run: staleness.latestRunId }),
        datasetId: report.datasetId,
        baseRunId: staleness.latestRunId,
        buildSpecDigest: evidence.run.ok ? evidence.run.value.spec_digest : null,
        evidenceFetchedAt: evidence.fetchedAt,
        blocks,
        evidenceRefs,
      });
      if (!result.ok) {
        setRefreshError(result.reason);
        return;
      }
      navigate(`/reports/${encodeURIComponent(created.id)}`);
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : t("reportEditor.createError"));
    }
  }

  if (report === undefined) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <p className="text-sm text-muted-foreground">{t("reportEditor.loading")}</p>
      </main>
    );
  }

  if (report === null) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <PageHeader title={t("reportEditor.notFoundTitle")} />
        <EmptyState
          title={t("reportEditor.notFoundHeading")}
          description={t("reportEditor.notFoundDesc")}
          actionLabel={t("reportEditor.backToList")}
          actionHref="/reports"
        />
      </main>
    );
  }

  const staleStatus = staleness?.status ?? null;

  const evidenceBlocks = report.blocks.filter(
    (block): block is BuilderEvidenceBlock => block.provenance === "BUILDER_EVIDENCE",
  );
  const assistantBlocks = report.blocks.filter(
    (block): block is AssistantInterpretationBlock => block.provenance === "ASSISTANT_INTERPRETATION",
  );
  const userBlocks = report.blocks.filter((block): block is UserContentBlock => block.provenance === "USER_CONTENT");

   // legacy summary enrichment: keep the saved block's summary as-is, fill only the
   // display value using current evidence summary (#258 legacy summary §1 — don't
   // force save).
  const displayEvidenceBlocks = evidenceBlocks.map((block) => {
    if (block.summary) return block;
    const fallback = legacySummaries?.[block.section];
    return fallback ? { ...block, summary: fallback } : block;
  });

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10" id="report-print-area">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-print-area, #report-print-area * { visibility: visible; }
          #report-print-area { position: absolute; inset: 0; padding: 1.5rem; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      <div className="print:hidden">
        <PageHeader title={t("reportEditor.editTitle")} meta={<span className="font-mono">{report.datasetId} · {report.baseRunId}</span>} />
      </div>

       {/* Prototype SSOT (`docs/prototype/kpubdata_ui_prototype_v1.html`) `.report-layout` same
           principle: desktop is document (fluid width) + Report Context (fixed width) 2-col,
           narrow viewport collapses to `grid-cols-1` so sidebar moves below document. */}
      <div
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start"
        data-testid="report-layout-grid"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="print:hidden">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="report-title">
              {t("reportEditor.titleLabel")}
            </label>
            <TextInput
              id="report-title"
              className="mt-1 text-base font-semibold"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleBlur}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {t("reportEditor.savedRevision", { revision: report.revision })}
                {lastSavedAt
                  ? t("reportEditor.lastSaved", { time: new Date(lastSavedAt).toLocaleTimeString("ko-KR") })
                  : ""}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={handleRefreshEvidence} loading={refreshing}>
                  {t("reportEditor.refreshEvidence")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => downloadMarkdown(report, staleStatus)}>
                  {t("reportEditor.downloadMarkdown")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => downloadHtml(report, staleStatus)}>
                  {t("reportEditor.downloadHtml")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => window.print()}>
                  {t("reportEditor.print")}
                </Button>
              </div>
            </div>
            {saveError ? <ErrorState className="mt-2 py-4" message={saveError} /> : null}
            {refreshError ? <ErrorState className="mt-2 py-4" message={refreshError} /> : null}
          </Card>

          {/* Sections 1–6. Report body based on Builder evidence — text summary appears first,
           tables collapse as detailed evidence. */}
          {displayEvidenceBlocks.map((block) => (
            <BlockView key={block.id} block={block} />
          ))}

           {/* Section 7. Assistant analysis */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">{t("reportEditor.assistantSection")}</h2>
            {assistantBlocks.length === 0 ? (
              <EmptyState
                className="py-8"
                title={t("reportEditor.noAssistantTitle")}
                description={t("reportEditor.noAssistantDesc")}
              />
            ) : (
              assistantBlocks.map((block) => (
                <BlockView
                  key={block.id}
                  block={block}
                  reportEvidenceRefs={block.isSameContext ? report.evidenceRefs : undefined}
                  onRemoveAssistantBlock={handleRemoveAssistantBlock}
                />
              ))
            )}
            <div className="print:hidden">
              <AssistantReportPanel report={report} onApprove={handleApproveAssistantBlock} />
            </div>
            <div className="print:hidden">
              <AssistantInboxPanel
                report={report}
                onApprove={handleApproveAssistantBlock}
                onNotesChanged={refreshPendingAssistantNoteCount}
              />
            </div>
          </div>

           {/* Section 8. User notes */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">{t("reportEditor.notesSection")}</h2>
            {userBlocks.map((block) =>
              editingUserBlockId === block.id ? (
                <UserContentEditor
                  key={block.id}
                  initialHeading={block.heading}
                  initialMarkdown={block.markdown}
                  onSave={(heading, markdown) => handleEditUserBlock(block.id, heading, markdown)}
                  onCancel={() => setEditingUserBlockId(null)}
                />
              ) : (
                <BlockView
                  key={block.id}
                  block={block}
                  onEditUserContent={() => setEditingUserBlockId(block.id)}
                  onDeleteUserContent={handleDeleteUserBlock}
                />
              ),
            )}
            <div className="print:hidden">
              {addingUserBlock ? (
                <UserContentEditor onSave={handleAddUserBlock} onCancel={() => setAddingUserBlock(false)} />
              ) : (
                <Button variant="secondary" onClick={() => setAddingUserBlock(true)}>
                  {t("reportEditor.addBlock")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* On desktop, this sidebar also pins sticky below the App Shell header
            (`Layout.tsx`'s `sticky top-0` header, ~4–4.5rem height) (#258 sticky sidebar
            fix) — so Report Context remains visible while scrolling the document. Since
            the sidebar can exceed viewport height, constrain its own height to viewport
            and allow internal scrolling so bottom content (Assistant cards, etc.) doesn't stay
            hidden under sticky overflow. On narrow viewports (`lg` and below), the existing
            1-column layout collapses sidebar below the document, so no sticky needed. */}
        <div
          className="print:hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-5.5rem)] lg:self-start lg:overflow-y-auto"
          data-testid="report-context-sidebar-wrapper"
        >
          <ReportContextSidebar
            report={report}
            staleness={staleness}
            stalenessLoading={stalenessLoading}
            onRecheck={() => runStalenessCheck(report)}
            onCreateFromLatest={staleness?.status === "stale" ? handleCreateFromLatest : undefined}
            assistantBlockCount={assistantBlocks.length}
            pendingAssistantNoteCount={pendingAssistantNoteCount}
          />
        </div>
      </div>
    </main>
  );
}
