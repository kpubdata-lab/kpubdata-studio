/**
 * New Build step 1 template card (separated from NewBuildPage in #379).
 */
import { catalogDataset, type CatalogState } from "@/features/build-spec/newBuildModel";
import { isTemplateAvailable, type BuildTemplate } from "@/features/build-spec/templates";
import { i18n } from "@/shared/i18n";
import { providerLabel } from "@/shared/lib/providerLabels";


/** Template select button — availability and ready states share this render (Phase 2 UI polish). */
export function TemplateButton({ template, catalog, onSelect }: { template: BuildTemplate; catalog: CatalogState; onSelect: (template: BuildTemplate) => void }) {
  const available = isTemplateAvailable(template, catalog);
  const resolvedDataset = catalogDataset(catalog.providers, template.values.provider, template.values.sourceDataset);
  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => onSelect(template)}
      className="rounded-2xl border border-border bg-card p-4 text-left transition enabled:hover:border-accent/50 enabled:hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-base font-semibold tracking-tight">{template.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
      {template.values.provider && template.values.sourceDataset ? (
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          {resolvedDataset
            ? `${providerLabel(template.values.provider)} / ${resolvedDataset.title}`
            : i18n.t("newBuild.errors.unknownSource")}
        </p>
      ) : null}
    </button>
  );
}
