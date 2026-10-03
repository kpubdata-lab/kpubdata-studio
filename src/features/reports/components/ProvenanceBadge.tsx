/**
 * Badge always visibly marks Report block provenance (#258 §2, §10).
 *
 * Visually distinguishes Builder evidence/AI interpretation/user content, revealing which
 * values are canonical and which are human or AI explanations — not just by color but also by text.
 */
import { useTranslation } from "react-i18next";
import type { BlockProvenance } from "../types";

const META: Record<BlockProvenance, { labelKey: string; className: string }> = {
  BUILDER_EVIDENCE: {
    labelKey: "builder",
    className: "bg-status-success-subtle text-status-success",
  },
  ASSISTANT_INTERPRETATION: {
    labelKey: "assistant",
    className: "bg-assistant-accent-subtle text-assistant-accent-text",
  },
  USER_CONTENT: {
    labelKey: "user",
    className: "bg-status-warning-subtle text-status-warning",
  },
};

export function ProvenanceBadge({ provenance, className }: { provenance: BlockProvenance; className?: string }) {
  const { t } = useTranslation();
  const meta = META[provenance];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className} ${className ?? ""}`}
    >
      {t(`reports.provenance.${meta.labelKey}`)}
    </span>
  );
}
