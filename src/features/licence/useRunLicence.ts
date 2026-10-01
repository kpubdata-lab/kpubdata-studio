/**
 * The terms of use of the BuildSpec a run used (`GET /builds/{run_id}/spec`).
 *
 * A table's licence is not a property of the table in Builder's contract: it is what the
 * BuildSpec of the run that produced the snapshot declared. So the terms shown beside a
 * snapshot are the terms of *that* run, and a run Builder cannot give the spec for (a
 * legacy run, the demo, an error) leaves them unknown rather than borrowed from another run.
 */
import { useEffect, useState } from "react";

import { getBuildSpecSnapshot, MockUnsupportedError } from "@/features/runs/api/runDetail";
import { ApiError } from "@/shared/lib/builderApi";

import { licenceTermsFromSpecYaml, type LicenceTerms } from "./terms";

export type RunLicenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; terms: LicenceTerms }
  /** Builder has no BuildSpec snapshot for this run (a legacy run, 404). */
  | { status: "unavailable"; reason: "legacy" }
  /** The demo has no Builder to ask. */
  | { status: "unavailable"; reason: "demo" }
  | { status: "unavailable"; reason: "error"; message: string };

/** Loads the terms for `runId`; an empty `runId` stays idle. */
export function useRunLicence(runId: string): RunLicenceState {
  const [state, setState] = useState<RunLicenceState & { runId?: string }>({ status: "idle" });
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    getBuildSpecSnapshot(runId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setState({ status: "loaded", terms: licenceTermsFromSpecYaml(snapshot.spec), runId });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof MockUnsupportedError) return setState({ status: "unavailable", reason: "demo", runId });
        if (cause instanceof ApiError && cause.status === 404) return setState({ status: "unavailable", reason: "legacy", runId });
        setState({ status: "unavailable", reason: "error", message: cause instanceof Error ? cause.message : String(cause), runId });
      });
    return () => controller.abort();
  }, [runId]);
  if (!runId) return { status: "idle" };
  // A result is only shown for the run it was loaded for.
  return state.runId === runId ? state : { status: "loading" };
}
