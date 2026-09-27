/**
 * Calculate field-level differences between two BuildSpecs (#13, v0.3 MVP).
 *
 * Flatten specs to path→value maps, compare, and produce lists of added/removed/changed paths.
 * Reused in execution history comparison (#12) and before/after diff UI.
 */
import type { BuildSpec } from "@/shared/lib/types";

export type SpecChangeKind = "added" | "removed" | "changed";

export interface SpecChange {
  /** Changed field path (example: `sources[0].dataset`) */
  path: string;
  /** Previous value (removed/changed) */
  before?: string;
  /** Subsequent value (added/changed) */
  after?: string;
  /** Kind of change */
  kind: SpecChangeKind;
}

/** Flatten BuildSpec to path→value map. */
function flatten(spec: BuildSpec): Map<string, string> {
  const map = new Map<string, string>();
  map.set("datasetId", spec.datasetId);
  map.set("title", spec.title);
  map.set("description", spec.description);
  spec.sources.forEach((source, i) => {
    if (source.kind && source.kind !== "public_api") map.set(`sources[${i}].kind`, source.kind);
    if (source.provider !== undefined) map.set(`sources[${i}].provider`, source.provider);
    if (source.dataset !== undefined) map.set(`sources[${i}].dataset`, source.dataset);
    if (source.uploadId) map.set(`sources[${i}].uploadId`, source.uploadId);
    if (source.format) map.set(`sources[${i}].format`, source.format);
    if (source.endpoint) map.set(`sources[${i}].endpoint`, source.endpoint);
    if (source.alias) map.set(`sources[${i}].alias`, source.alias);
    for (const [key, value] of Object.entries(source.params)) {
      map.set(`sources[${i}].params.${key}`, String(value));
    }
  });
  spec.exports.forEach((target, i) => {
    map.set(`exports[${i}].format`, target.format);
    for (const [key, value] of Object.entries(target.options ?? {})) {
      map.set(`exports[${i}].options.${key}`, String(value));
    }
  });
  for (const [key, value] of Object.entries(spec.metadata)) {
    map.set(`metadata.${key}`, String(value));
  }
  return map;
}

/**
 * Return field-level differences between two BuildSpecs in path order.
 *
 * @param before - Previous spec.
 * @param after - Subsequent spec.
 * @returns Changes in ascending path order. Empty if identical.
 */
export function diffSpecs(before: BuildSpec, after: BuildSpec): SpecChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const changes: SpecChange[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    if (x === y) continue;
    if (x === undefined) changes.push({ path, after: y, kind: "added" });
    else if (y === undefined) changes.push({ path, before: x, kind: "removed" });
    else changes.push({ path, before: x, after: y, kind: "changed" });
  }
  return changes;
}
