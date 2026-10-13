/**
 * Build-spec validation API entry point.
 *
 * With real Builder integration on (`VITE_USE_REAL_BUILDER=true`) it calls
 * Builder `/validate`; otherwise it returns a mock (always valid) so Studio
 * works standalone (#29/#37). `validationClient()` is the one place that is chosen (#902).
 */
import { serializeSpec } from "@/features/build-spec/specMapping";
import { ApiError, builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import { localizeBuilderProblems } from "@/shared/lib/exportPathMessages";
import type { BuildSpec } from "@/shared/lib/types";

/** Determines whether ApiError.details is Builder's invalid response ({status, problems}). */
export function asInvalidDetails(details: unknown): { problems: string[] } | null {
  if (details && typeof details === "object" && "status" in details) {
    const record = details as { status?: unknown; problems?: unknown };
    if (record.status === "invalid") {
      // Export-path refusals (kpubdata-builder#1320) are shown in the user's language.
      const problems = Array.isArray(record.problems) ? record.problems.map(String) : [];
      return { problems: localizeBuilderProblems(details, problems) };
    }
  }
  return null;
}

/**
 * Validates the current build spec and returns the error list.
 *
 * @param spec - Build spec to validate.
 * @returns Validity and a list of error strings.
 */
export async function validateSpec(spec: BuildSpec): Promise<SpecValidation> {
  return validationClient().validate(spec);
}

export interface SpecValidation {
  valid: boolean;
  errors: string[];
}

/** What spec validation asks for: Builder's verdict, or the demo's, which passes every spec. */
export interface ValidationClient {
  validate(spec: BuildSpec): Promise<SpecValidation>;
}

export const demoValidationClient: ValidationClient = {
  validate: async () => ({ valid: true, errors: [] }),
};

export const realValidationClient: ValidationClient = { validate: validateWithBuilder };

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function validationClient(): ValidationClient {
  return isRealBuilderEnabled() ? realValidationClient : demoValidationClient;
}

async function validateWithBuilder(spec: BuildSpec): Promise<SpecValidation> {
  try {
    const result = await builderApi.validate(serializeSpec(spec));
    // invalid/error can arrive as 2xx too, so reasons are mapped per status.
    if (result.status === "valid") return { valid: true, errors: [] };
    if (result.status === "invalid") {
      return { valid: false, errors: result.problems.map(String) };
    }
    return { valid: false, errors: [result.error] };
  } catch (cause) {
    // Also handles Builder returning validation failure as 400 + {status:"invalid", problems}.
    if (cause instanceof ApiError) {
      const invalid = asInvalidDetails(cause.details);
      if (invalid) return { valid: false, errors: invalid.problems };
    }
    throw cause;
  }
}
