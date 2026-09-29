/**
 * Which source datasets need an application, grouped so one application is one row (#412).
 *
 * data.go.kr issues one service key but approves each dataset's use separately, and one
 * approval page can unlock several datasets. kpubdata's probe groups by service for that
 * reason (kpubdata#504); here the service is the application URL the catalogue gives.
 *
 * Nothing is guessed. A dataset whose catalogue entry has no `application` is "unknown",
 * not "no application needed", and a missing `quota` is unknown, not zero.
 */
import type { CatalogResponse } from "@/shared/lib/builderApi";

export interface ApplicationDataset {
  name: string;
  title: string;
  /** Provider wording for the daily cap, verbatim; `null` when the spec does not say. */
  quota: string | null;
}

export interface ApplicationGroup {
  provider: string;
  /** The page where the application is made — one row per URL. */
  url: string;
  datasets: ApplicationDataset[];
}

export interface ApplicationGuide {
  groups: ApplicationGroup[];
  /** Source datasets whose catalogue entry says nothing about an application. */
  unknownCount: number;
}

export function buildApplicationGuide(catalog: CatalogResponse): ApplicationGuide {
  const groups = new Map<string, ApplicationGroup>();
  let unknownCount = 0;
  for (const provider of catalog.providers) {
    for (const dataset of provider.datasets) {
      const application = dataset.application ?? null;
      if (application === null) {
        unknownCount += 1;
        continue;
      }
      if (!application.required) continue;
      const key = `${provider.name}\n${application.url}`;
      const group = groups.get(key) ?? { provider: provider.name, url: application.url, datasets: [] };
      group.datasets.push({ name: dataset.name, title: dataset.title, quota: dataset.quota ?? null });
      groups.set(key, group);
    }
  }
  const sorted = [...groups.values()].sort(
    (a, b) => a.provider.localeCompare(b.provider) || b.datasets.length - a.datasets.length || a.url.localeCompare(b.url),
  );
  return { groups: sorted, unknownCount };
}
