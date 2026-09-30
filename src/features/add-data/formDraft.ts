/**
 * The form-shaped draft slot (`build-spec/draftStorage`) in the one creation flow (#534).
 *
 * Ask KPubData's "create a table draft" action writes its values into that slot. It used
 * to be read by the second creation wizard at `/refresh-jobs/new`; that wizard is gone, so
 * `/add` offers the slot too and turns it into a BuildSpec with the same `toBuildSpec`
 * the form used — no second mapping.
 */
import { clearDraft, hasDraft, loadDraft } from "@/features/build-spec/draftStorage";
import { redactDraftForStorage, toBuildSpec, type BuildFormValues } from "@/features/build-spec/newBuildModel";
import { buildFormValuesSchema } from "@/shared/lib/schemas";
import type { BuildSpec } from "@/shared/lib/types";

/** Whether a form-shaped draft is waiting. */
export function hasFormDraft(): boolean {
  return hasDraft();
}

/**
 * The waiting form-shaped draft as a BuildSpec, removing it from storage. `null` when
 * there is none, or when it cannot become a spec (for example a redacted credential that
 * must be typed again) — the flow then starts empty rather than from a broken spec.
 */
export function takeFormDraftSpec(): BuildSpec | null {
  const values = loadDraft<BuildFormValues>(buildFormValuesSchema, undefined, redactDraftForStorage);
  clearDraft();
  if (!values) return null;
  return toBuildSpec(values, null).spec ?? null;
}

/** Drop the waiting form-shaped draft. */
export function discardFormDraft(): void {
  clearDraft();
}
