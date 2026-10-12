/**
 * Zod schema for Assistant structured LLM responses (#256).
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
import * as z from "zod/mini";
import { jsonValueSchema } from "@/shared/lib/schemas";

export const ASSISTANT_STAGES = ["bronze", "silver", "gold"] as const;
export const ASSISTANT_QUERY_STAGES = ["silver", "gold"] as const;

/** A BuildSpec patch op. Allow only a subset of RFC6902 JSON Patch (add/replace/remove). */
export const buildSpecPatchOpSchema = z.object({
  op: z.enum(["add", "replace", "remove"]),
  path: z.string().check(z.minLength(1)),
  value: z.optional(jsonValueSchema),
});
export type BuildSpecPatchOp = z.infer<typeof buildSpecPatchOpSchema>;

const openProviderActionSchema = z.object({
  type: z.literal("OPEN_PROVIDER"),
  provider: z.string().check(z.minLength(1)),
  reason: z.string().check(z.minLength(1)),
});

const openBuildActionSchema = z.object({
  type: z.literal("OPEN_BUILD"),
  runId: z.string().check(z.minLength(1)),
  reason: z.string().check(z.minLength(1)),
});

const openQualityActionSchema = z.object({
  type: z.literal("OPEN_QUALITY"),
  datasetId: z.string().check(z.minLength(1)),
  runId: z.optional(z.string().check(z.minLength(1))),
  source: z.optional(z.string().check(z.minLength(1))),
  stage: z.optional(z.enum(ASSISTANT_STAGES)),
  reason: z.string().check(z.minLength(1)),
});

const patchBuildSpecActionSchema = z.object({
  type: z.literal("PATCH_BUILDSPEC"),
  runId: z.string().check(z.minLength(1)),
  patch: z.array(buildSpecPatchOpSchema).check(z.minLength(1)),
  reason: z.string().check(z.minLength(1)),
});

const createBuildDraftActionSchema = z.object({
  type: z.literal("CREATE_BUILD_DRAFT"),
  values: z.object({
    datasetId: z.string().check(z.minLength(1)),
    title: z.string().check(z.minLength(1)),
    description: z.string().check(z.minLength(1)),
    provider: z.string().check(z.minLength(1)),
    sourceDataset: z.string().check(z.minLength(1)),
    sourceParams: z.optional(z.string()),
    outputPath: z.optional(z.string()),
    exportFormats: z.optional(z.array(z.string())),
  }),
  reason: z.string().check(z.minLength(1)),
});

const addReportBlockActionSchema = z.object({
  type: z.literal("ADD_REPORT_BLOCK"),
  note: z.string().check(z.minLength(1)),
  reason: z.string().check(z.minLength(1)),
});

/** Allowlist enforced by issue #256. Any action outside this list is rejected by the discriminated union. */
export const assistantActionSchema = z.discriminatedUnion("type", [
  openProviderActionSchema,
  openBuildActionSchema,
  openQualityActionSchema,
  patchBuildSpecActionSchema,
  createBuildDraftActionSchema,
  addReportBlockActionSchema,
]);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const assistantEvidenceRefSchema = z.object({
  kind: z.enum(["dataset", "run", "stage", "quality", "schema_drift", "catalog"]),
  id: z.string().check(z.minLength(1)),
  label: z.string().check(z.minLength(1)),
});

export const assistantGeneratedSqlSchema = z.object({
  sql: z.string().check(z.minLength(1)),
  stage: z.enum(ASSISTANT_QUERY_STAGES),
  source: z.optional(z.string().check(z.minLength(1))),
});

/** The top-level JSON response shape requested from the LLM. */
export const assistantStructuredResponseSchema = z.object({
  answer: z.string().check(z.minLength(1)),
  evidenceRefs: z._default(z.array(assistantEvidenceRefSchema), []),
  generatedSql: z._default(z.nullable(assistantGeneratedSqlSchema), null),
  suggestedActions: z._default(z.array(assistantActionSchema), []),
});
export type AssistantStructuredResponseInput = z.infer<typeof assistantStructuredResponseSchema>;
