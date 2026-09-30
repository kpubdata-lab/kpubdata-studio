/**
 * Wizard step 0 — template selection (#379).
 *
 * While catalog is still loading/error, can't determine availability, so show original grid as-is —
 * don't flicker "mostly disabled" appearance.
 */
import { useTranslation } from "react-i18next";

import { isTemplateAvailable, TEMPLATES, type BuildTemplate } from "@/features/build-spec/templates";
import { TemplateButton } from "@/features/build-spec/components/TemplateButton";
import type { CatalogState } from "@/features/build-spec/newBuildModel";

export interface TemplateStepProps {
  catalog: CatalogState;
  onSelect: (template: BuildTemplate) => void;
}

export function TemplateStep({ catalog, onSelect }: TemplateStepProps) {
  const { t } = useTranslation();
  const available = TEMPLATES.filter((template) => isTemplateAvailable(template, catalog));
  const unavailable = TEMPLATES.filter((template) => !isTemplateAvailable(template, catalog));

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold tracking-tight">{t("newBuild.template.selectTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("newBuild.template.selectDesc")}</p>
      {catalog.status === "loading" ? (
        <p className="text-sm text-muted-foreground">{t("newBuild.template.catalogLoading")}</p>
      ) : null}
      {catalog.status === "error" ? (
        <p role="alert" className="text-sm text-status-failure">
          {t("newBuild.template.catalogError", { error: catalog.error })}
        </p>
      ) : null}
      {catalog.status === "loaded" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((template) => (
              <TemplateButton key={template.id} template={template} catalog={catalog} onSelect={onSelect} />
            ))}
          </div>
          {unavailable.length > 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-4">
              <p className="text-sm font-medium text-muted-foreground">
                {t("newBuild.templates.unavailableCount", { count: unavailable.length })}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {unavailable.map((template) => (
                  <TemplateButton key={template.id} template={template} catalog={catalog} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((template) => (
            <TemplateButton key={template.id} template={template} catalog={catalog} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
