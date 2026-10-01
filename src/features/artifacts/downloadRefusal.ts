/**
 * Artifact file downloads Builder refuses by policy rather than by fault (#643).
 *
 * `GET /artifacts/{run_id}/{file_path}` answers three refusals that are not errors in the
 * usual sense — the file exists and the request was right, but the data may not leave:
 *
 * - 403 `redistribution_forbidden` (builder#688): the source terms forbid redistribution.
 *   Every file of the run is held back, Gold included; `redistribution.sources` names why.
 * - 403 `declared_pii_withheld` (builder#900): a Bronze or Silver file of a source with
 *   declared PII holds it unmasked; `columns` names the columns. Gold files are served.
 * - 503 `pii_declaration_unavailable` (builder#900): the source's kpubdata PII declaration
 *   could not be read, so the read fails closed; `dataset` names the source.
 *
 * Only names are read from the body — column names, a dataset key, source keys — never a
 * value, so explaining a refusal cannot leak what it withholds.
 */
import { ApiError } from "@/shared/lib/builderApi";

export type ArtifactDownloadRefusal =
  | { code: "redistribution_forbidden"; sources: string[] }
  | { code: "declared_pii_withheld"; columns: string[] }
  | { code: "pii_declaration_unavailable"; dataset: string | null };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** Source keys whose own verdict is `forbidden`, from the `redistribution` record. */
function forbiddenSources(redistribution: unknown): string[] {
  if (!redistribution || typeof redistribution !== "object") return [];
  const sources = (redistribution as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const { source, verdict } = entry as { source?: unknown; verdict?: unknown };
    return verdict === "forbidden" && typeof source === "string" && source.length > 0 ? [source] : [];
  });
}

/**
 * Reads a policy refusal out of a failed artifact download.
 *
 * @param cause - What `downloadArtifact` threw.
 * @returns The refusal, or null for any other failure (shown as a plain error).
 */
export function artifactDownloadRefusal(cause: unknown): ArtifactDownloadRefusal | null {
  if (!(cause instanceof ApiError)) return null;
  const body = cause.details;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (cause.status === 403 && record.code === "redistribution_forbidden") {
    return { code: "redistribution_forbidden", sources: forbiddenSources(record.redistribution) };
  }
  if (cause.status === 403 && record.code === "declared_pii_withheld") {
    return { code: "declared_pii_withheld", columns: strings(record.columns) };
  }
  if (cause.status === 503 && record.code === "pii_declaration_unavailable") {
    return {
      code: "pii_declaration_unavailable",
      dataset: typeof record.dataset === "string" && record.dataset.length > 0 ? record.dataset : null,
    };
  }
  return null;
}
