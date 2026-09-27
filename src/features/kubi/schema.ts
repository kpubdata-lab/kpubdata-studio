/**
 * Zod schema for Kubi structured LLM responses (#256).
 *
 * The first gate in the four-stage hallucination mitigation pipeline:
 * `LLM output → Zod → catalog/evidence reconciliation → Builder validate/query → user approval`.
 * Zod validates only the "shape" — whether referenced resources exist is decided by
 * `crossCheck.ts` against evidence/catalog.
 *
 * Suggested Actions are restricted to the allowlist fixed by issue #256
 * (OPEN_PROVIDER / OPEN_BUILD / OPEN_QUALITY / PATCH_BUILDSPEC / CREATE_BUILD_DRAFT /
 * ADD_REPORT_BLOCK) as a discriminated union. Any action outside this list is rejected at the
 * Zod stage (prevent execution of unknown actions).
 */
import { z } from "zod";
import { jsonValueSchema } from "@/shared/lib/schemas";

export const KUBI_STAGES = ["bronze", "silver", "gold"] as const;
export const KUBI_QUERY_STAGES = ["silver", "gold"] as const;

/** A BuildSpec patch op. Allow only a subset of RFC6902 JSON Patch (add/replace/remove). */
export const buildSpecPatchOpSchema = z.object({
  op: z.enum(["add", "replace", "remove"]),
  path: z.string().min(1),
  value: jsonValueSchema.optional(),
});
export type BuildSpecPatchOp = z.infer<typeof buildSpecPatchOpSchema>;

const openProviderActionSchema = z.object({
  type: z.literal("OPEN_PROVIDER"),
  provider: z.string().min(1),
  reason: z.string().min(1),
});

const openBuildActionSchema = z.object({
  type: z.literal("OPEN_BUILD"),
  runId: z.string().min(1),
  reason: z.string().min(1),
});

const openQualityActionSchema = z.object({
  type: z.literal("OPEN_QUALITY"),
  datasetId: z.string().min(1),
  runId: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  stage: z.enum(KUBI_STAGES).optional(),
  reason: z.string().min(1),
});

const patchBuildSpecActionSchema = z.object({
  type: z.literal("PATCH_BUILDSPEC"),
  runId: z.string().min(1),
  patch: z.array(buildSpecPatchOpSchema).min(1),
  reason: z.string().min(1),
});

const createBuildDraftActionSchema = z.object({
  type: z.literal("CREATE_BUILD_DRAFT"),
  values: z.object({
    datasetId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    provider: z.string().min(1),
    sourceDataset: z.string().min(1),
    sourceParams: z.string().optional(),
    outputPath: z.string().optional(),
    exportFormats: z.array(z.string()).optional(),
  }),
  reason: z.string().min(1),
});

const addReportBlockActionSchema = z.object({
  type: z.literal("ADD_REPORT_BLOCK"),
  note: z.string().min(1),
  reason: z.string().min(1),
});

/** Allowlist enforced by issue #256. Any action outside this list is rejected by the discriminated union. */
export const kubiActionSchema = z.discriminatedUnion("type", [
  openProviderActionSchema,
  openBuildActionSchema,
  openQualityActionSchema,
  patchBuildSpecActionSchema,
  createBuildDraftActionSchema,
  addReportBlockActionSchema,
]);
export type KubiAction = z.infer<typeof kubiActionSchema>;

export const kubiEvidenceRefSchema = z.object({
  kind: z.enum(["dataset", "run", "stage", "quality", "schema_drift", "catalog"]),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const kubiGeneratedSqlSchema = z.object({
  sql: z.string().min(1),
  stage: z.enum(KUBI_QUERY_STAGES),
  source: z.string().min(1).optional(),
});

/** The top-level JSON response shape requested from the LLM. */
export const kubiStructuredResponseSchema = z.object({
  answer: z.string().min(1),
  evidenceRefs: z.array(kubiEvidenceRefSchema).default([]),
  generatedSql: kubiGeneratedSqlSchema.nullable().default(null),
  suggestedActions: z.array(kubiActionSchema).default([]),
});
export type KubiStructuredResponseInput = z.infer<typeof kubiStructuredResponseSchema>;
