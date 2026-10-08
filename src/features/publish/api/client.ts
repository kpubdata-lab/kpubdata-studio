/**
 * The publish client: one interface, and the two things that implement it (#794).
 *
 * As in `features/datasets/api/client.ts`: the publish screens ask `publishClient()` and
 * do not know whether a Builder or the demo answers. `client.contract.test.ts` holds the
 * two to the same expectations. What is the demo's own, and written down:
 *
 * - it publishes nowhere: a publish answers at once with a result for the destination
 *   asked, and no credential is looked at;
 * - a run whose readiness says "not ready" is refused with 409 `publish_conflict`, where
 *   a Builder sends its blockers (`PublishBlockedResponse`);
 * - it keeps no receipts, so there is never one to reconcile or reset: both answer 404
 *   `receipt_not_found`, as a Builder does for a publish it has no receipt of.
 */
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type PublishCredential,
  type PublishReadinessResponse,
  type PublishRequest,
  type PublishResponse,
  type PublishTarget,
} from "@/shared/lib/builderApi";
import type { PublishReceiptReset, PublishReconcileResponse } from "@/shared/lib/builderApi.schema";
import { i18n } from "@/shared/i18n";
import { MOCK_PUBLISH_READINESS, mockPublishResult } from "./mockData";

/** All wording in this file lives under `publish.errors.*` (#350). */
const t = (key: string): string => i18n.t(`publish.errors.${key}`);

/**
 * What the publish screens ask for. Every method resolves with the response as Builder's
 * contract shapes it, rejects with an `ApiError` carrying Builder's status (and `code`,
 * where there is one) when it is refused, and rejects, without an answer, when `signal`
 * is already aborted. `credential` goes in a header and never in a URL or a body (#615).
 */
export interface PublishClient {
  /** `GET /builds/{run_id}/publish/readiness`. 404 for a run that is not there. */
  readiness(
    runId: string,
    target: PublishTarget,
    signal?: AbortSignal,
    credential?: PublishCredential,
  ): Promise<PublishReadinessResponse>;
  /** `POST /builds/{run_id}/publish`. 404 for a run that is not there; 409 when refused. */
  publish(
    runId: string,
    request: PublishRequest,
    signal?: AbortSignal,
    credential?: PublishCredential,
  ): Promise<PublishResponse>;
  /** `POST /builds/{run_id}/publish/reconcile` (#728). 404 `receipt_not_found` with no receipt. */
  reconcile(
    runId: string,
    request: { target: PublishTarget; destination: string },
    signal?: AbortSignal,
    credential?: PublishCredential,
  ): Promise<PublishReconcileResponse>;
  /** `DELETE /builds/{run_id}/publish/receipt` (#728). 404 `receipt_not_found` with no receipt. */
  resetReceipt(
    runId: string,
    target: PublishTarget,
    destination: string,
    signal?: AbortSignal,
    credential?: PublishCredential,
  ): Promise<PublishReceiptReset>;
}

export const realPublishClient: PublishClient = {
  readiness: async (runId, target, signal, credential) => builderApi.getPublishReadiness(runId, target, signal, credential),
  publish: async (runId, request, signal, credential) => builderApi.publishBuild(runId, request, signal, credential),
  reconcile: async (runId, request, signal, credential) => builderApi.reconcilePublish(runId, request, signal, credential),
  resetReceipt: async (runId, target, destination, signal, credential) =>
    builderApi.resetPublishReceipt(runId, target, destination, signal, credential),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function noReceipt(): ApiError {
  return new ApiError(404, t("recoveryFailed"), { code: "receipt_not_found" });
}

/**
 * A demo client over `readiness`: what each run's readiness is, and so whether it may
 * be published. The demo uses its fixtures; a test gives its own to reach what they do
 * not hold.
 */
export function createDemoPublishClient(
  readinessByRun: Readonly<Record<string, PublishReadinessResponse>>,
): PublishClient {
  return {
    async readiness(runId, _target, signal) {
      throwIfAborted(signal);
      const readiness = readinessByRun[runId];
      if (!readiness) throw new ApiError(404, t("readinessNotFound"));
      // A copy: a caller that changed it would change the demo for everyone after it.
      return structuredClone(readiness);
    },
    async publish(runId, request, signal) {
      throwIfAborted(signal);
      const readiness = readinessByRun[runId];
      if (!readiness) throw new ApiError(404, t("runNotFound"));
      if (!readiness.ready || readiness.blockers.length > 0) {
        throw new ApiError(409, t("notReady"), { code: "publish_conflict" });
      }
      return mockPublishResult(
        runId,
        request.destination,
        request.options?.private ?? true,
        readiness.redistribution ?? null,
        request.options?.confirm_non_commercial === true,
      );
    },
    async reconcile(_runId, _request, signal) {
      throwIfAborted(signal);
      throw noReceipt();
    },
    async resetReceipt(_runId, _target, _destination, signal) {
      throwIfAborted(signal);
      throw noReceipt();
    },
  };
}

export const demoPublishClient: PublishClient = createDemoPublishClient(MOCK_PUBLISH_READINESS);

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function publishClient(): PublishClient {
  return isRealBuilderEnabled() ? realPublishClient : demoPublishClient;
}
