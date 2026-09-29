/**
 * Renders a single Report block as read-only aligned with its provenance (#258 §10, IA redesign).
 *
 * BUILDER_EVIDENCE blocks are always read-only (to prevent users from secretly swapping values —
 * #258 §3, §10). To modify, refresh evidence and regenerate, or add user explanation via a separate
 * USER_CONTENT block.
 *
 * IA redesign (no list-only view): show `summary` (deterministic narrative) first; existing
 * `markdown` (table/detail evidence) goes in `<details>` collapsible. Table itself is preserved —
 * only position changes.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n";
import { Card } from "@/shared/ui";
import { renderMarkdownToReact } from "../markdown";
import type { BuilderEvidenceBlock, BuilderEvidenceSection, ReportBlock, ReportEvidenceRef } from "../types";
import { ProvenanceBadge } from "./ProvenanceBadge";

/** Language is fixed at module load time if constant; resolve at call time to reflect switches. */
function evidenceStatusLabel(status: string): string {
  return status === "ok" ? "" : i18n.t(`reports.block.status.${status}`);
}

function sectionLabel(section: BuilderEvidenceSection): string {
  return i18n.t(`reports.block.section.${section}`);
}

/**
 * Reuse `<details className="group">` disclosure pattern from NewBuildPage(#97), but control
 * open state via React state — relying only on browser default toggle risks varying behavior
 * across test environments/screen reader combinations. Prevent default on summary click and
 * control open/close by state only.
 */
function BuilderEvidenceBlockCard({ block }: { block: BuilderEvidenceBlock }) {
  const { t } = useTranslation();
  const [detailOpen, setDetailOpen] = useState(false);

  // When output cannot be verified, summary already contains full reason; expanding table repeats
  // same text — omit detail disclosure only then (#258 IA redesign §4).
  const hasDetail = !(block.section === "output" && block.evidenceStatus === "unavailable");
  // Many sections where summary already contains evidenceStatus reason as text; output does not
  // duplicate badge warning.
  const showStatusBanner = block.evidenceStatus !== "ok" && block.section !== "output";

  return (
    <Card className="space-y-3" data-testid={`block-${block.section}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{sectionLabel(block.section)}</h3>
        <ProvenanceBadge provenance="BUILDER_EVIDENCE" />
      </div>
      {showStatusBanner ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {evidenceStatusLabel(block.evidenceStatus)}
          {block.unavailableReason ? `: ${block.unavailableReason}` : ""}
        </p>
      ) : null}
      <div className="space-y-2 text-sm leading-relaxed text-foreground">
        {block.summary ? renderMarkdownToReact(block.summary) : renderMarkdownToReact(block.markdown)}
      </div>
      {block.summary && hasDetail ? (
        <details className="group border-t border-border pt-2" open={detailOpen}>
          <summary
            className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              setDetailOpen((prev) => !prev);
            }}
          >
            {t("reports.block.showDetail")}
            <span className="text-sm transition group-open:rotate-180" aria-hidden="true">
              ⌄
            </span>
          </summary>
          {detailOpen ? (
            <div className="mt-3 space-y-2 text-sm text-foreground">{renderMarkdownToReact(block.markdown)}</div>
          ) : null}
        </details>
      ) : null}
    </Card>
  );
}

export function BlockView({
  block,
  reportEvidenceRefs,
  onEditUserContent,
  onDeleteUserContent,
  onRemoveAssistantBlock,
}: {
  block: ReportBlock;
  /** ASSISTANT_INTERPRETATION block passed only when its dataset/run context matches this Report (#258 §7). */
  reportEvidenceRefs?: ReportEvidenceRef[];
  onEditUserContent?: (id: string) => void;
  onDeleteUserContent?: (id: string) => void;
  onRemoveAssistantBlock?: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (block.provenance === "BUILDER_EVIDENCE") {
    return <BuilderEvidenceBlockCard block={block} />;
  }

  if (block.provenance === "ASSISTANT_INTERPRETATION") {
    return (
      <Card className="space-y-2 border-indigo-200 dark:border-indigo-900/60" data-testid="block-assistant">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("reports.block.assistantTitle")}</h3>
          <div className="flex items-center gap-2">
            <ProvenanceBadge provenance="ASSISTANT_INTERPRETATION" />
            {onRemoveAssistantBlock ? (
              <button
                type="button"
                onClick={() => onRemoveAssistantBlock(block.id)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                {t("reports.block.remove")}
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("reports.block.context", {
            dataset: block.sourceContext.datasetId ?? "N/A",
            run: block.sourceContext.runId ?? "N/A",
          })}
          {block.sourceContext.stage ? ` · Stage: ${block.sourceContext.stage}` : ""}
        </p>
        {!block.isSameContext ? (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300">
            {t("reports.block.otherContext")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("reports.block.generatedAt", {
            at: new Date(block.generatedAt).toLocaleString(
              i18n.language?.startsWith("en") ? "en-US" : "ko-KR",
            ),
          })}
          {block.provider ? ` · provider ${block.provider}` : ""}
          {block.model ? ` · model ${block.model}` : ""}
        </p>
        <div className="space-y-2 text-sm text-foreground">{renderMarkdownToReact(block.note)}</div>
        <p className="text-xs italic text-muted-foreground">
          {t("reports.block.reason", { reason: block.reason })}
        </p>
        {block.isSameContext && reportEvidenceRefs && reportEvidenceRefs.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("reports.block.linkedEvidence", {
              refs: reportEvidenceRefs.map((ref) => ref.label).join(", "),
            })}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="space-y-2 border-amber-200 dark:border-amber-900/60" data-testid="block-user">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{block.heading}</h3>
        <div className="flex items-center gap-2">
          <ProvenanceBadge provenance="USER_CONTENT" />
          {onEditUserContent ? (
            <button
              type="button"
              onClick={() => onEditUserContent(block.id)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {t("reports.block.edit")}
            </button>
          ) : null}
          {onDeleteUserContent ? (
            <button
              type="button"
              onClick={() => onDeleteUserContent(block.id)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {t("reports.block.delete")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="space-y-2 text-sm text-foreground">{renderMarkdownToReact(block.markdown)}</div>
    </Card>
  );
}
