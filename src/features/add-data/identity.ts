/**
 * Auto-generate Dataset identity (#250 amendment 2).
 *
 * Across Public API/File/URL sources, do not require users to manually enter Dataset ID/title/description each time.
 * Instead, create deterministic default values from already-selected/entered info (catalog dataset, filename, endpoint).
 * These values are only "defaults"; users can override them anytime in Advanced Settings (Dataset metadata) —
 * draft's *Touched flags prevent auto-generation from overwriting them afterward (see AddDataPage auto-reflect effect).
 *
 * BuildSpec still requires dataset_id/title/description — what changes is only "who fills them".
 */
import { i18n } from "@/shared/i18n";
import type { CatalogDataset, CatalogProvider } from "@/shared/lib/builderApi";

export function findProvider(providers: readonly CatalogProvider[], name: string): CatalogProvider | undefined {
  return providers.find((p) => p.name === name);
}

export function findDataset(
  providers: readonly CatalogProvider[],
  provider: string,
  dataset: string,
): CatalogDataset | undefined {
  return findProvider(providers, provider)?.datasets.find((d) => d.name === dataset);
}

/** Safe slug for use as dataset_id. Keep only ASCII letters, digits, and Hangul; replace others with `-`. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "dataset";
}

/** Join multiple parts with `-` then slugify (e.g., provider+dataset name combination). */
export function datasetIdFromParts(...parts: string[]): string {
  return slugify(parts.filter(Boolean).join("-"));
}

/** Convert filename/path segments to human-readable titles, e.g., "my-file_name" → "My File Name". */
function humanize(base: string): string {
  const spaced = base.replace(/[-_]+/g, " ").trim().replace(/\s+/g, " ");
  if (!spaced) return base;
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DatasetIdentity {
  datasetId: string;
  title: string;
  description: string;
}

/**
 * Public API: create identity from provider/dataset selected in catalog.
 *
 * dataset_id is a deterministic slug based on provider+dataset name; title/description use
 * catalog dataset values directly (treat actual Builder catalog response as authoritative, not illustrative).
 */
export function identityFromCatalog(provider: string, dataset: CatalogDataset): DatasetIdentity {
  return {
    datasetId: datasetIdFromParts(provider, dataset.name),
    title: dataset.title,
    // BuildSpec.description is a required field — if catalog does not provide description (null),
    // do not fabricate a value; use a factual default stating provider/dataset source only.
    description: dataset.description ?? i18n.t("addData.identity.fromCatalog", { provider, name: dataset.name }),
  };
}

/**
 * File: create dataset_id/title from uploaded filename (excluding extension).
 *
 * BuildSpec.description is a required field (buildSpecSchema) and cannot be empty — file source has no user-created
 * description, so provide a factual default statement describing the upload fact (users can edit this in Advanced Settings anytime).
 */
export function identityFromFilename(filename: string): DatasetIdentity {
  const base = filename.replace(/\.[^./\\]+$/, "");
  const title = humanize(base) || filename;
  return { datasetId: slugify(base), title, description: i18n.t("addData.identity.fromFile", { filename }) };
}

/**
 * URL: create dataset_id/title from endpoint hostname+path only.
 *
 * Caution: the URL object created by `new URL(endpoint)` preserves `username`/`password`/`search`/`hash` as-is
 * (`user:pass@host`, `?token=...`, `#frag` are all readable) — the claim "URL objects don't contain credential/query" is false.
 * Safety here comes from using only `hostname`/`pathname` attributes via allowlist when building identity, never reading the rest
 * (username/password/search/hash). For the same reason (BuildSpec required field), provide a factual default describing the endpoint.
 */
export function identityFromUrl(endpoint: string): DatasetIdentity {
  try {
    const url = new URL(endpoint);
    const path = url.pathname.replace(/\/+$/, "");
    const base = `${url.hostname}${path}`;
    const title = humanize(base) || url.hostname;
    // description also uses only hostname+path (base) without query string/credentials —
    // using the original endpoint would leak token-like values.
    return { datasetId: slugify(base), title, description: i18n.t("addData.identity.fromUrl", { host: base }) };
  } catch {
    return { datasetId: "", title: "", description: "" };
  }
}
