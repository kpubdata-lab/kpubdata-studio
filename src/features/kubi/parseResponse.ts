/**
 * Extracts and validates a structured response from raw LLM output (#256).
 *
 * This performs only the first of four hallucination gates (Zod parsing). Zod checks the
 * "shape" only — whether referenced resources actually exist (datasets, runs, etc.) is
 * verified later by `crossCheck.ts`.
 */
import { i18n } from "@/shared/i18n";
import { kubiEvidenceRefSchema, kubiStructuredResponseSchema } from "./schema";
import type { KubiStructuredResponse } from "./types";

export type ParseKubiResponseResult =
  | { ok: true; response: KubiStructuredResponse; malformedEvidenceRefs: string[] }
  | { ok: false; message: string };

/** Produce a short, user-facing description for a malformed evidenceRef item. */
function describeMalformedRef(item: unknown): string {
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "?";
    const id = typeof record.id === "string" ? record.id : "?";
    return `kind="${kind}" id="${id}"`;
  }
  const serialized = JSON.stringify(item);
  return serialized ? serialized.slice(0, 60) : String(item);
}

/**
 * Validate evidenceRefs on an item-by-item basis (#256 review — evidenceRefs are tolerant).
 *
 * evidenceRefs are for display only and are later reconciled against evidence by
 * `crossCheck`. A single malformed item (e.g., an out-of-list `kind`) should not cause the
 * entire `answer`/`generatedSql`/`suggestedActions` to be discarded. Remove only the bad
 * items and let the strict schema validate the remainder.
 */
function sanitizeEvidenceRefs(candidate: unknown): { malformed: string[] } {
  if (!candidate || typeof candidate !== "object") return { malformed: [] };
  const record = candidate as Record<string, unknown>;
  if (!("evidenceRefs" in record)) return { malformed: [] };

  const raw = record.evidenceRefs;
  if (!Array.isArray(raw)) {
    // If evidenceRefs is not an array, clear it (does not affect execution) and keep the rest.
    record.evidenceRefs = [];
    return { malformed: [describeMalformedRef(raw)] };
  }

  const valid: unknown[] = [];
  const malformed: string[] = [];
  for (const item of raw) {
    if (kubiEvidenceRefSchema.safeParse(item).success) valid.push(item);
    else malformed.push(describeMalformedRef(item));
  }
  record.evidenceRefs = valid;
  return { malformed };
}

/**
 * Extract a ```json``` block (or use the whole text) from raw LLM output and validate with Zod.
 *
 * @param rawOutput - The accumulated text returned by provider.stream().
 * @returns A validated structured response or a human-readable failure reason.
 */
export function parseKubiResponse(rawOutput: string): ParseKubiResponseResult {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return { ok: false, message: i18n.t("kubi.parse.empty") };
  }

  const jsonMatch = trimmed.match(/```json\s*\n([\s\S]*?)\n```/) ?? trimmed.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : trimmed;

  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: i18n.t("kubi.parse.notJson") };
  }

  // evidenceRefs are tolerated and sanitized item-by-item. answer/generatedSql/suggestedActions
  // are validated by the strict schema as-is (fail-closed).
  const { malformed: malformedEvidenceRefs } = sanitizeEvidenceRefs(candidate);

  const result = kubiStructuredResponseSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    return { ok: false, message: i18n.t("kubi.parse.shapeMismatch", { issues }) };
  }

  return {
    ok: true,
    response: {
      answer: result.data.answer,
      evidenceRefs: result.data.evidenceRefs,
      generatedSql: result.data.generatedSql,
      suggestedActions: result.data.suggestedActions,
    },
    malformedEvidenceRefs,
  };
}
