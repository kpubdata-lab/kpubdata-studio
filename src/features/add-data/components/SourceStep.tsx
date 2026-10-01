/**
 * Create table step 1 — Configure: the source choice, above its settings (#250, #534).
 *
 * Directly follows the 3-card layout from Prototype
 * (`kpubdata_ui_prototype_v1.html`'s `addData()`/`source-card`):
 * Public API / File Upload / URL·REST API.
 */
import { useTranslation } from "react-i18next";
import type { SourceKind } from "@/shared/lib/types";
import { Card } from "@/shared/ui";

interface SourceOption {
  kind: SourceKind;
  /** i18n key for the title (`addData.source.kindTitle.*`) and description (`addData.source.kind.*`) — don't hardcode strings (#350, #531). */
  descriptionKey: string;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { kind: "public_api", descriptionKey: "publicApi" },
  { kind: "file", descriptionKey: "file" },
  { kind: "url", descriptionKey: "url" },
];

export interface SourceStepProps {
  selected: SourceKind | null;
  onSelect: (kind: SourceKind) => void;
}

export function SourceStep({ selected, onSelect }: SourceStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold tracking-tight">{t("addData.source.title")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("addData.source.desc")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {SOURCE_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => onSelect(option.kind)}
            aria-pressed={selected === option.kind}
            className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          >
            <Card
              variant={selected === option.kind ? "success" : "default"}
              className="h-full transition hover:border-brand-primary/50 hover:shadow-md"
            >
              <p className="text-base font-semibold tracking-tight">{t(`addData.source.kindTitle.${option.descriptionKey}`)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(`addData.source.kind.${option.descriptionKey}`)}</p>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
