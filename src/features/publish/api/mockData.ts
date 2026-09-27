/**
 * Deterministic mock data for publish readiness/results (UI audit #4).
 *
 * Unlike every other Builder endpoint (getDataset, listBuildStages,
 * getBuildQuality etc. — see `src/features/datasets/api/index.ts`),
 * `getPublishReadiness`/`publishBuild` had no `isRealBuilderEnabled()`
 * branch, so mock mode always attempted real network requests. Local/demo
 * environments have no Builder server, the request failed, and the
 * readiness card only ever showed loading→error (effectively an empty
 * card) — this file is the deterministic fixture that mock switch points
 * at. It does not recompute Builder readiness; it hardcodes what the real
 * Builder would have returned per known mock run (#246 principle: never
 * invent values).
 */
import type { PublishReadinessResponse, PublishResponse } from "@/shared/lib/builderApi";

export const MOCK_PUBLISH_READINESS: Record<string, PublishReadinessResponse> = {
  "air-quality-20260621": {
    run_id: "air-quality-20260621",
    target: "huggingface",
    ready: true,
    blockers: [],
    warnings: [],
  },
  "dur-product-info-20260620": {
    run_id: "dur-product-info-20260620",
    target: "huggingface",
    ready: true,
    blockers: [],
    warnings: [],
  },
  "dur-usjnt-taboo-20260620": {
    run_id: "dur-usjnt-taboo-20260620",
    target: "huggingface",
    ready: true,
    blockers: [],
    warnings: [{ code: "license_unconfirmed", message: "원본 라이선스가 아직 확인되지 않았습니다." }],
  },
  "dur-pregnancy-taboo-20260621": {
    run_id: "dur-pregnancy-taboo-20260621",
    target: "huggingface",
    ready: false,
    blockers: [{ code: "run_not_completed", message: "이 run은 아직 실행 중입니다(running)." }],
    warnings: [],
  },
  "dur-older-adult-caution-20260618": {
    run_id: "dur-older-adult-caution-20260618",
    target: "huggingface",
    ready: false,
    blockers: [{ code: "stage_failed", message: "Bronze stage가 실패해 Gold 산출물이 없습니다." }],
    warnings: [],
  },
  "dur-dosage-caution-20260621": {
    run_id: "dur-dosage-caution-20260621",
    target: "huggingface",
    ready: false,
    blockers: [{ code: "run_not_started", message: "이 run은 아직 실행되지 않았습니다(queued)." }],
    warnings: [],
  },
  "air-2026-08-14": {
    run_id: "air-2026-08-14",
    target: "huggingface",
    ready: false,
    blockers: [{ code: "partial_failure", message: "source kma__weather의 silver stage가 실패했습니다." }],
    warnings: [],
  },
  "air-2026-08-13": {
    run_id: "air-2026-08-13",
    target: "huggingface",
    ready: true,
    blockers: [],
    warnings: [],
  },
  "population-2026-08-13": {
    run_id: "population-2026-08-13",
    target: "huggingface",
    ready: false,
    blockers: [{ code: "gold_unavailable", message: "Gold export가 아직 계산되지 않았습니다(unavailable)." }],
    warnings: [],
  },
  "transport-2026-08-12": {
    run_id: "transport-2026-08-12",
    target: "huggingface",
    ready: true,
    blockers: [],
    warnings: [],
  },
};

export function mockPublishResult(runId: string, destination: string, isPrivate: boolean): PublishResponse {
  return {
    run_id: runId,
    target: "huggingface",
    publisher: "kpubdata-builder (mock)",
    destination,
    reference: `https://huggingface.co/datasets/${destination}`,
    artifact_count: 1,
    status: isPrivate ? "published_private" : "published_public",
  };
}
