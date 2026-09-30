/**
 * Report Context sidebar (`/reports/:reportId`, #258 IA redesign).
 *
 * Shows only values actually present in this Report — Prototype SSOT demo toggles like
 * "Quality summary ON / Schema drift ON / Lineage ON / Analysis ideas ON" have no corresponding
 * feature, so not migrated. Evidence status judgment/recheck logic reuses existing
 * `EvidenceStatusBanner` (not rebuilt).
 */
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/features/datasets/model";
import { Card } from "@/shared/ui";
import type { EvidenceStalenessResult } from "../staleness";
import type { BuilderEvidenceBlock, ReportDraft } from "../types";
import { EvidenceStatusBanner } from "./EvidenceStatusBanner";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export function ReportContextSidebar({
  report,
  staleness,
  stalenessLoading,
  onRecheck,
  onCreateFromLatest,
  assistantBlockCount,
  pendingAssistantNoteCount,
}: {
  report: ReportDraft;
  staleness: EvidenceStalenessResult | null;
  stalenessLoading: boolean;
  onRecheck: () => void;
  onCreateFromLatest?: () => void;
  assistantBlockCount: number;
  pendingAssistantNoteCount: number;
}) {
  const { t } = useTranslation();
  const qualityBlock = report.blocks.find(
    (block): block is BuilderEvidenceBlock => block.provenance === "BUILDER_EVIDENCE" && block.section === "quality",
  );
  const qualityCounts = qualityBlock?.qualityCounts;

  const sourceKeys = [...new Set(report.evidenceRefs.filter((ref) => ref.kind === "stage").map((ref) => ref.id))];

  return (
    <aside className="flex flex-col gap-4">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("reports.contextSidebar.title")}</p>
        <div className="mt-2 divide-y divide-border">
          <Row label={t("labels.table")} value={report.datasetId} />
          <Row label={t("reports.contextSidebar.baseRun")} value={report.baseRunId} />
          {sourceKeys.length > 0 ? <Row label={t("labels.source")} value={sourceKeys.join(", ")} /> : null}
          <Row label={t("reports.contextSidebar.specDigest")} value={report.buildSpecDigest ?? "N/A"} />
          <Row label={t("reports.contextSidebar.evidenceFetchedAt")} value={formatDateTime(report.evidenceFetchedAt)} />
        </div>
      </Card>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("reports.contextSidebar.evidenceStatus")}</p>
        <EvidenceStatusBanner
          result={staleness}
          loading={stalenessLoading}
          onRecheck={onRecheck}
          onCreateFromLatest={onCreateFromLatest}
        />
      </div>

      {qualityCounts ? (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("labels.quality")}</p>
          <div className="mt-2 divide-y divide-border">
            <Row label="PASS" value={String(qualityCounts.pass)} />
            <Row label="WARN" value={String(qualityCounts.warn)} />
            <Row label="FAIL" value={String(qualityCounts.fail)} />
            <Row label={t("reports.contextSidebar.evaluatedRules")} value={String(qualityCounts.evaluated)} />
          </div>
        </Card>
      ) : null}

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("reports.contextSidebar.askKpubdata")}</p>
        <div className="mt-2 divide-y divide-border">
          <Row label={t("reports.contextSidebar.assistantBlocks")} value={t("reports.contextSidebar.countUnit", { count: assistantBlockCount })} />
          <Row
            label={t("reports.contextSidebar.pendingNotes")}
            value={pendingAssistantNoteCount > 0 ? t("reports.contextSidebar.noteUnit", { count: pendingAssistantNoteCount }) : t("reports.contextSidebar.none")}
          />
        </div>
      </Card>
    </aside>
  );
}
