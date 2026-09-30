/**
 * Component showing visual diff of two BuildSpecs (#13, v0.3 MVP).
 *
 * Render diffSpecs result as added (green)/removed (red)/changed (yellow) rows.
 * Show "no changes" message if unchanged.
 */
import { diffSpecs, type SpecChangeKind } from "@/features/build-spec/specDiff";
import type { BuildSpec } from "@/shared/lib/types";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/shared/ui";

const KIND_META: Record<SpecChangeKind, { labelKey: string; className: string; sign: string }> = {
  added: {
    labelKey: "added",
    className: "bg-status-success-subtle text-status-success",
    sign: "+",
  },
  removed: {
    labelKey: "removed",
    className: "bg-status-failure-subtle text-status-failure",
    sign: "−",
  },
  changed: {
    labelKey: "changed",
    className: "bg-status-warning-subtle text-status-warning",
    sign: "~",
  },
};

export interface SpecDiffProps {
  /** Previous spec */
  before: BuildSpec;
  /** After spec */
  after: BuildSpec;
}

/**
 * Render field-level diff of two specs as list.
 *
 * @param props - before/after specs.
 * @returns Spec diff element.
 */
export function SpecDiff({ before, after }: SpecDiffProps) {
  const { t } = useTranslation();
  const changes = diffSpecs(before, after);

  if (changes.length === 0) {
    return <EmptyState title={t("specDiff.noDiff")} />;
  }

  return (
    <ul className="divide-y divide-border">
      {changes.map((change) => {
        const meta = KIND_META[change.kind];
        return (
          <li key={change.path} className="flex flex-wrap items-center gap-3 px-1 py-2 text-sm">
            <span
              className={`inline-flex w-12 justify-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
            >
              {meta.sign} {t(`specDiff.${meta.labelKey}`)}
            </span>
            <span className="font-mono text-foreground">{change.path}</span>
            <span className="text-muted-foreground">
              {change.kind === "changed" ? (
                <>
                  <span className="line-through">{change.before}</span> → {change.after}
                </>
              ) : change.kind === "added" ? (
                change.after
              ) : (
                <span className="line-through">{change.before}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
