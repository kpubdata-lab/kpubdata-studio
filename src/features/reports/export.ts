/**
 * Report export (#258 §12, §13).
 *
 * Provides only formats actually implemented: Markdown download, safe HTML download, Browser Print.
 * PDF/DOCX not created or advertised — Browser Print opens browser print dialog, not "Generate PDF".
 *
 * Exported files always include title/dataset/base run/createdAt/evidenceFetchedAt/provenance
 * distinction/stale-orphan warning. Assistant/user content only passes through safe renderer in
 * `markdown.ts` to HTML — raw source never inserted.
 */
import { i18n } from "@/shared/i18n";
import { escapeHtml, renderMarkdownToHtml } from "./markdown";
import type { EvidenceRunStatus } from "./types";
import type { ReportDraft } from "./types";

/** All sentence keys in this file live under this namespace (#350). */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(`reports.export.${key}`, params ?? {});

/** Status labels created at call time, not module constant — constant would ignore language switch. */
function statusLabel(status: EvidenceRunStatus): string {
  return t(`status.${status}`);
}

const FILENAME_INVALID_CHARS = /["*/:<>?\\|]/g;

/** Remove filename-invalid chars like path separators; cap length. */
export function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(FILENAME_INVALID_CHARS, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "report";
}

function metadataLines(report: ReportDraft, staleness: EvidenceRunStatus | null): string[] {
  const lines = [
    `Report: ${report.title}`,
    `Table: ${report.datasetId}`,
    `Base Run: ${report.baseRunId}`,
    `BuildSpec digest: ${report.buildSpecDigest ?? "N/A"}`,
    `${t("meta.createdAt")}: ${report.createdAt}`,
    `${t("meta.evidenceFetchedAt")}: ${report.evidenceFetchedAt}`,
    `${t("meta.exportedAt")}: ${new Date().toISOString()}`,
  ];
  if (staleness) lines.push(`${t("meta.evidenceStatus")}: ${statusLabel(staleness)}`);
  return lines;
}

function provenanceLabel(kind: "BUILDER_EVIDENCE" | "ASSISTANT_INTERPRETATION" | "USER_CONTENT"): string {
  if (kind === "BUILDER_EVIDENCE") return "[Engine Evidence]";
  return kind === "ASSISTANT_INTERPRETATION" ? t("provenance.assistant") : t("provenance.user");
}

/** Create Markdown file content. */
export function generateMarkdownExport(report: ReportDraft, staleness: EvidenceRunStatus | null): string {
  const parts = [`# ${report.title}`, "", metadataLines(report, staleness).map((line) => `- ${line}`).join("\n"), ""];

  for (const block of report.blocks) {
    if (block.provenance === "BUILDER_EVIDENCE") {
      parts.push(`## ${block.title} ${provenanceLabel("BUILDER_EVIDENCE")}`);
      if (block.evidenceStatus !== "ok") {
        parts.push(
          `> ${t("meta.evidenceStatusShort")}: ${block.evidenceStatus}${block.unavailableReason ? ` (${block.unavailableReason})` : ""}`,
        );
      }
      if (block.summary) {
        parts.push(block.summary);
        parts.push(`### ${t("detailHeading")}`);
      }
      parts.push(block.markdown);
    } else if (block.provenance === "ASSISTANT_INTERPRETATION") {
      parts.push(`## ${t("assistantHeading")} ${provenanceLabel("ASSISTANT_INTERPRETATION")}`);
      if (!block.isSameContext) {
        parts.push(
          `> ${t("assistantOtherRun", { dataset: block.sourceContext.datasetId ?? "N/A", run: block.sourceContext.runId ?? "N/A" })}`,
        );
      }
      parts.push(
        `${t("meta.createdAt")}: ${block.generatedAt}${block.provider ? ` / provider: ${block.provider}` : ""}${block.model ? ` / model: ${block.model}` : ""}`,
      );
      parts.push(block.note);
      parts.push(`_${t("reasonLabel")}: ${block.reason}_`);
    } else {
      parts.push(`## ${block.heading} ${provenanceLabel("USER_CONTENT")}`);
      parts.push(block.markdown);
    }
    parts.push("");
  }

  return parts.join("\n");
}

const HTML_DOC_STYLE = `
  body { font-family: -apple-system, "Segoe UI", sans-serif; color: #1a1a1a; max-width: 860px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.65; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.2rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: .3rem; }
  table { border-collapse: collapse; width: 100%; margin: .75rem 0; font-size: .9rem; }
  th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; }
  .meta { background: #f6f7f9; border: 1px solid #e2e4e8; border-radius: 8px; padding: 1rem; font-size: .85rem; }
  .tag { display: inline-block; font-size: .7rem; font-weight: 600; padding: .1rem .5rem; border-radius: 999px; margin-left: .4rem; }
  .tag-evidence { background: #e6f4ea; color: #1e6b3b; }
  .tag-assistant { background: #eef0ff; color: #3730a3; }
  .tag-user { background: #fff4e5; color: #92400e; }
  .warn { color: #92400e; background: #fff4e5; border: 1px solid #f3d9a8; border-radius: 6px; padding: .5rem .75rem; font-size: .85rem; }
`;

/** Create safe self-contained HTML document. Never includes `<script>`. */
export function generateHtmlExport(report: ReportDraft, staleness: EvidenceRunStatus | null): string {
  const meta = metadataLines(report, staleness).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const staleWarning =
    staleness && staleness !== "current" ? `<p class="warn">${escapeHtml(statusLabel(staleness))}</p>` : "";

  const blocksHtml = report.blocks
    .map((block) => {
      if (block.provenance === "BUILDER_EVIDENCE") {
        const statusNote =
          block.evidenceStatus !== "ok"
            ? `<p class="warn">${escapeHtml(t("meta.evidenceStatusShort"))}: ${escapeHtml(block.evidenceStatus)}${block.unavailableReason ? ` (${escapeHtml(block.unavailableReason)})` : ""}</p>`
            : "";
        const summaryHtml = block.summary
          ? `${renderMarkdownToHtml(block.summary)}<h3>${escapeHtml(t("detailHeading"))}</h3>`
          : "";
        return `<h2>${escapeHtml(block.title)}<span class="tag tag-evidence">Engine Evidence</span></h2>${statusNote}${summaryHtml}${renderMarkdownToHtml(block.markdown)}`;
      }
      if (block.provenance === "ASSISTANT_INTERPRETATION") {
        const contextNote = !block.isSameContext
          ? `<p class="warn">${escapeHtml(t("assistantOtherRunHtml", { dataset: block.sourceContext.datasetId ?? "N/A", run: block.sourceContext.runId ?? "N/A" }))}</p>`
          : "";
        return `<h2>${escapeHtml(t("assistantHeading"))}<span class="tag tag-assistant">${escapeHtml(t("tag.ai"))}</span></h2>${contextNote}<p><small>${escapeHtml(t("meta.createdAt"))}: ${escapeHtml(block.generatedAt)}${block.provider ? ` / provider: ${escapeHtml(block.provider)}` : ""}${block.model ? ` / model: ${escapeHtml(block.model)}` : ""}</small></p>${renderMarkdownToHtml(block.note)}<p><em>${escapeHtml(t("reasonLabel"))}: ${escapeHtml(block.reason)}</em></p>`;
      }
      return `<h2>${escapeHtml(block.heading)}<span class="tag tag-user">${escapeHtml(t("tag.user"))}</span></h2>${renderMarkdownToHtml(block.markdown)}`;
    })
    .join("\n");

  return [
    "<!doctype html>",
    '<html lang="ko"><head><meta charset="utf-8" />',
    `<title>${escapeHtml(report.title)}</title>`,
    `<style>${HTML_DOC_STYLE}</style>`,
    "</head><body>",
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<ul class="meta">${meta}</ul>`,
    staleWarning,
    blocksHtml,
    "</body></html>",
  ].join("\n");
}

/** Create Blob and trigger browser download (production web app — unrelated to Claude Artifact sandbox). */
export function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadMarkdown(report: ReportDraft, staleness: EvidenceRunStatus | null): void {
  triggerDownload(`${sanitizeFilename(report.title)}.md`, generateMarkdownExport(report, staleness), "text/markdown;charset=utf-8");
}

export function downloadHtml(report: ReportDraft, staleness: EvidenceRunStatus | null): void {
  triggerDownload(`${sanitizeFilename(report.title)}.html`, generateHtmlExport(report, staleness), "text/html;charset=utf-8");
}
