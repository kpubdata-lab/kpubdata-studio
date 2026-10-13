/**
 * Where each export of a BuildSpec writes, and which export paths Builder refuses
 * (kpubdata-builder#1320).
 *
 * Every export writes into the run's Gold directory, beside the Gold artifacts. Builder
 * refuses a spec before running it when an export path leaves that directory
 * (`unsafe_export_path`), names a Gold artifact (`reserved_export_path`), or equals or
 * contains another export's path (`export_path_collision`). The checks below restate
 * Builder's `export_path_parts` and `export_layout_conflicts` so the user sees the problem
 * while typing; Builder stays the authority and its verdict is shown as well
 * (`exportPathMessages.ts`). This module has no UI dependency, so the E2E suite can use it.
 */
/** What the Gold stage and the dataset card write into the directory exports share. */
const GOLD_RESERVED_NAMES = ["table.parquet", "package.json", "splits", "README.md", "card.json"];
/** Files a Kaggle export writes next to its CSV. */
const KAGGLE_METADATA = "dataset-metadata.json";
const KAGGLE_CARD_FILES = ["README.md", "card.json"];

export const EXPORT_PATH_CODES = ["unsafe_export_path", "reserved_export_path", "export_path_collision"] as const;
export type ExportPathCode = (typeof EXPORT_PATH_CODES)[number];

export interface ExportPathProblem {
  /** Position of the export in `exports`. */
  index: number;
  code: ExportPathCode;
}

const FORMAT_EXTENSION: Record<string, string> = {
  jsonl: "jsonl",
  markdown: "md",
  parquet: "parquet",
};

/**
 * The path an export writes to when it names none.
 *
 * File exports go below `base` as `data.<ext>`, numbered after the first. A Hugging Face
 * export replaces its whole folder, so it takes `base` itself only when it is the spec's
 * only export; otherwise it gets a numbered sibling folder and never contains another
 * export.
 *
 * @param base - The spec's output folder.
 * @param format - Export format.
 * @param index - Position of the export in `exports`.
 * @param count - Number of exports in the spec.
 */
export function defaultExportPath(base: string, format: string, index: number, count: number): string {
  if (format === "huggingface") {
    return index === 0 && count === 1 ? base : `${base}-${index + 1}`;
  }
  const extension = FORMAT_EXTENSION[format] ?? format;
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return `${base}/data${suffix}.${extension}`;
}

/** The form under which case-insensitive and normalizing filesystems see one entry. */
function collisionKey(segment: string): string {
  return segment.normalize("NFC").toUpperCase().toLowerCase().replace(/[. ]+$/, "");
}

/** Folded segments of a path below the Gold directory, or `null` for a path Builder refuses. */
function pathKey(path: string): string[] | null {
  if (/^([\\/]|[A-Za-z]:)/.test(path)) return null;
  const parts = path.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return null;
  if (parts.some((part) => part === ".." || collisionKey(part) === "")) return null;
  return parts.map(collisionKey);
}

/** Whether one folded path equals the other or is a folder containing it. */
function overlaps(a: string[], b: string[]): boolean {
  const n = Math.min(a.length, b.length);
  return a.slice(0, n).every((part, i) => part === b[i]);
}

/**
 * Export paths Builder would refuse, one problem per refused export, in order.
 *
 * @param exports - Wire exports (`kind`, `output_path`) as Studio sends them.
 */
export function exportPathProblems(exports: ReadonlyArray<{ kind: string; output_path: string }>): ExportPathProblem[] {
  const reserved = new Set(GOLD_RESERVED_NAMES.map(collisionKey));
  const layouts: Array<{ index: number; key: string[]; side: string[][] }> = [];
  const problems: ExportPathProblem[] = [];
  exports.forEach((target, index) => {
    if (target.output_path.trim() === "") return;
    const key = pathKey(target.output_path);
    if (key === null) {
      problems.push({ index, code: "unsafe_export_path" });
      return;
    }
    const side: string[][] = [];
    if (target.kind === "kaggle") {
      const parent = key.slice(0, -1);
      side.push([...parent, collisionKey(KAGGLE_METADATA)]);
      if (parent.length > 0) side.push(...KAGGLE_CARD_FILES.map((name) => [...parent, collisionKey(name)]));
    }
    layouts.push({ index, key, side });
  });
  layouts.forEach((layout, i) => {
    if (reserved.has(layout.key[0] ?? "")) {
      problems.push({ index: layout.index, code: "reserved_export_path" });
      return;
    }
    const collides = layouts.some(
      (other, j) => (j < i && overlaps(layout.key, other.key)) || other.side.some((file) => overlaps(layout.key, file)),
    );
    if (collides) problems.push({ index: layout.index, code: "export_path_collision" });
  });
  return problems.sort((a, b) => a.index - b.index);
}
