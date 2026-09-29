/**
 * Reports saved under old names still open (#479).
 *
 * #461 renamed the assistant block's provenance `KUBI_INTERPRETATION` →
 * `ASSISTANT_INTERPRETATION` without migrating what was already stored. The GitHub
 * Pages demo shares localStorage with anyone who tried it before, and an old block fell
 * through to the user-content branch, which rendered its missing `markdown` and threw.
 * Every stored block now passes through here on read: the old name is mapped, a block
 * of a shape this version does not know keeps its text as user content instead of
 * crashing, and a missing text field reads as empty. The next save writes the new form.
 */
import type { ReportBlock } from "./types";

const LEGACY_PROVENANCE: Record<string, ReportBlock["provenance"]> = {
  KUBI_INTERPRETATION: "ASSISTANT_INTERPRETATION",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One stored block in the current shape, or `null` when there is nothing to keep. */
export function normalizeBlock(raw: unknown): ReportBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const block = raw as Record<string, unknown>;
  const stored = text(block.provenance);
  const provenance = LEGACY_PROVENANCE[stored] ?? stored;
  const base = {
    id: text(block.id) || `legacy-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: text(block.createdAt),
    updatedAt: text(block.updatedAt),
  };

  if (provenance === "ASSISTANT_INTERPRETATION") {
    return {
      ...(block as object),
      ...base,
      provenance,
      note: text(block.note),
      reason: text(block.reason),
      sourceContext: (block.sourceContext && typeof block.sourceContext === "object" ? block.sourceContext : {}) as {
        datasetId?: string;
        runId?: string;
        stage?: string;
      },
      isSameContext: block.isSameContext === true,
      generatedAt: text(block.generatedAt),
    } as ReportBlock;
  }
  if (provenance === "BUILDER_EVIDENCE") {
    return { ...(block as object), ...base, provenance, title: text(block.title), markdown: text(block.markdown) } as ReportBlock;
  }
  if (provenance === "USER_CONTENT") {
    return { ...base, provenance, heading: text(block.heading), markdown: text(block.markdown) };
  }
  // A shape this version does not know: keep whatever text it carries, visibly.
  return {
    ...base,
    provenance: "USER_CONTENT",
    heading: text(block.heading) || text(block.title),
    markdown: text(block.markdown) || text(block.note),
  };
}

export function normalizeBlocks(raw: unknown): ReportBlock[] {
  return Array.isArray(raw) ? raw.map(normalizeBlock).filter((block): block is ReportBlock => block !== null) : [];
}
