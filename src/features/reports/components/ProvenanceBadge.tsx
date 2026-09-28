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
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  KUBI_INTERPRETATION: {
    labelKey: "assistant",
    className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  },
  USER_CONTENT: {
    labelKey: "user",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
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
