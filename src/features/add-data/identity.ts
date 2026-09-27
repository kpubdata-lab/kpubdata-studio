/**
 * Auto-generate Dataset identity (#250 amendment 2).
 *
 * Across all three source kinds (Public API/File/URL), users should not enter
 * Dataset ID/title/description manually each time. Instead, generate deterministic
 * defaults from already-selected/entered info (catalog dataset, filename, endpoint).
 * Values generated here are only "defaults"; users can override in advanced
 * settings (Dataset metadata) any time — draft `*Touched` flags prevent auto-gen
 * from overwriting after that (see auto-reflect effect in `AddDataPage`).
 *
 * The fact that BuildSpec requires dataset_id/title/description does not change —
 * only who fills those values changes.
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

/** Safe slug for use as dataset_id. Keep only alphanumerics and Hangul; replace rest with `-`. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "dataset";
}

/** Join multiple parts with `-` then slugify (e.g., provider + dataset name combo). */
export function datasetIdFromParts(...parts: string[]): string {
  return slugify(parts.filter(Boolean).join("-"));
}

/** Transform filename/path segment into human-readable title (e.g., "my-file_name" → "My File Name"). */
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
 * Public API: generate identity from provider/dataset selected in catalog.
 *
 * dataset_id is deterministic slug based on provider+dataset name; title/description
 * use catalog dataset values directly (Builder catalog response is canonical, not
 * Prototype or illustrative values).
 */
export function identityFromCatalog(provider: string, dataset: CatalogDataset): DatasetIdentity {
  return {
    datasetId: datasetIdFromParts(provider, dataset.name),
    title: dataset.title,
    // BuildSpec.description is required — if catalog lacks description (null),
    // do not invent one; use factual default describing provider/dataset source.
    description: dataset.description ?? i18n.t("addData.identity.fromCatalog", { provider, name: dataset.name }),
  };
}

/**
 * File: generate dataset_id/title from uploaded filename (minus extension).
 *
 * BuildSpec.description is required (`buildSpecSchema`), cannot be left empty —
 * File source has no user-authored description, so provide factual default
 * sentence describing the upload itself (can be edited anytime in advanced settings).
 */
export function identityFromFilename(filename: string): DatasetIdentity {
  const base = filename.replace(/\.[^./\\]+$/, "");
  const title = humanize(base) || filename;
  return { datasetId: slugify(base), title, description: i18n.t("addData.identity.fromFile", { filename }) };
}

/**
 * URL: generate dataset_id/title from endpoint hostname + path only.
 *
 * Caution: `new URL(endpoint)` URL object itself preserves `username`/`password`/
 * `search`/`hash` as-is (`user:pass@host`, `?token=...`, `#frag` all readable) —
 * saying "URL object does not hold credential/query" is wrong. Safe here because
 * when building identity, we only allowlist `hostname`/`pathname` from that object
 * and never read the rest (username/password/search/hash). Description also uses
 * default (BuildSpec required field) factually describing endpoint source.
 */
export function identityFromUrl(endpoint: string): DatasetIdentity {
  try {
    const url = new URL(endpoint);
    const path = url.pathname.replace(/\/+$/, "");
    const base = `${url.hostname}${path}`;
    const title = humanize(base) || url.hostname;
    // description also uses only hostname+path without query string/credential (base)
    // — using full endpoint would leak tokens and similar secrets.
    return { datasetId: slugify(base), title, description: i18n.t("addData.identity.fromUrl", { host: base }) };
  } catch {
    return { datasetId: "", title: "", description: "" };
  }
}
