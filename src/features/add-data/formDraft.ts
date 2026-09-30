/**
 * The form-shaped draft slot (`build-spec/draftStorage`) in the one creation flow (#534).
 *
 * Ask KPubData's "create a table draft" action writes its values into that slot. It used
 * to be read by the second creation wizard at `/refresh-jobs/new`; that wizard is gone, so
 * `/add` offers the slot too and turns it into a BuildSpec with the same `toBuildSpec`
 * the form used — no second mapping.
 */
import { clearDraft, defaultDraftKey, hasDraft, loadDraft, subscribeDraftChanges } from "@/features/build-spec/draftStorage";
import { redactDraftForStorage, toBuildSpec, type BuildFormValues } from "@/features/build-spec/newBuildModel";
import { buildFormValuesSchema } from "@/shared/lib/schemas";
import type { BuildSpec } from "@/shared/lib/types";

/**
 * What opening the waiting form-shaped draft gave: a spec, or the reason it cannot become
 * one together with the values it holds, so the flow can keep what is usable and ask for
 * the rest.
 */
export type FormDraftResult = { spec: BuildSpec } | { error: string; values: BuildFormValues };

/** Whether a form-shaped draft is waiting. */
export function hasFormDraft(): boolean {
  return hasDraft();
}

/**
 * Call `listener` whenever the form-shaped draft is written or removed, in this tab or
 * another (#604). Ask KPubData approves its draft while `/add` may already be open, and
 * navigating to the same route does not mount the page again, so the page subscribes
 * instead of reading the slot only once.
 *
 * @returns A function that stops listening.
 */
export function subscribeFormDraft(listener: () => void): () => void {
  return subscribeDraftChanges((key) => {
    // `null`: another tab cleared the whole store, which may include this slot.
    if (key === null || key === defaultDraftKey()) listener();
  });
}

/**
 * The waiting form-shaped draft as a BuildSpec. `null` when there is none.
 *
 * The draft is removed only when it became a spec. When it cannot — a credential redacted
 * in storage that must be typed again, a partial draft, parameters that are not JSON —
 * it stays in storage and the result carries `toBuildSpec`'s error and the values, so the
 * draft is never lost without a word.
 */
export function takeFormDraftSpec(): FormDraftResult | null {
  const values = loadDraft<BuildFormValues>(buildFormValuesSchema, undefined, redactDraftForStorage);
  if (!values) return null;
  const { spec, error } = toBuildSpec(values, null);
  if (spec) {
    clearDraft();
    return { spec };
  }
  return { error: error ?? "", values };
}

/** Drop the waiting form-shaped draft. */
export function discardFormDraft(): void {
  clearDraft();
}
