/**
 * Saved BuildSpec data model (#260).
 *
 * A Saved BuildSpec is an asset the user explicitly names and keeps via a
 * "save" action. It is a distinct concept from all three of these and is
 * never blended with them:
 * - Auto Draft (`build-spec/draftStorage.ts`): a single transient in-progress
 *   draft, not yet run.
 * - run_id spec cache (`build-spec/specStore.ts`): merely Studio's memory of
 *   a spec it executed — not a user "save" — and auto-deleted over the cap.
 * - run snapshot (Builder #487, not yet built): the canonical spec the
 *   Builder server actually used. A Saved BuildSpec does not replace this
 *   canon — it is only a browser-local cache.
 */
import type { BuildSpec } from "@/shared/lib/types";

/**
 * Validation results as of the last save of this spec.
 * Reflects the latest state only when re-saved (overwritten) without
 * modification — to avoid showing "passed" for content different from the
 * saved-time spec, this value only ever holds what was actually verified at
 * that save.
 */
export type SavedSpecValidationStatus = "validated_pass" | "validated_fail" | "not_validated";

export interface SavedSpecValidation {
  status: SavedSpecValidationStatus;
  errors: string[];
}

export interface SavedBuildSpec {
  id: string;
  name: string;
  /** Credential-looking values only ever arrive pre-masked by redactSecrets(). */
  spec: BuildSpec;
  validation: SavedSpecValidation;
  createdAt: string;
  updatedAt: string;
  /** Save format version (per item, separate from the store envelope version). */
  version: number;
  /** Optimistic-concurrency counter to detect earlier saves from another tab of the same browser. */
  revision: number;
}

/** Summary needed by the Saved BuildSpec list screen (name/provider/output/validation). */
export interface SavedBuildSpecSummary {
  id: string;
  name: string;
  provider: string;
  outputPath: string;
  validationStatus: SavedSpecValidationStatus;
  updatedAt: string;
}

export const SAVED_SPEC_VERSION = 1;
