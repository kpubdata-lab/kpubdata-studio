/**
 * Thin wrapper for Builder API used by Add Data Workbench (#250).
 *
 * Wraps the client from `shared/lib/builderApi.ts` without reimplementing new
 * endpoints. This module handles (1) mock/real branching, and (2) light polishing
 * of responses into a form the UI can directly consume.
 */
import { builderApi, isRealBuilderEnabled, type CatalogResponse, type ProviderTestResponse, type UploadMetadata } from "@/shared/lib/builderApi";
import type { SourceFormat } from "@/shared/lib/types";

const MOCK_CATALOG: CatalogResponse = {
  providers: [
    {
      name: "datago",
      datasets: [
        {
          name: "apt_trade",
          title: "아파트 실거래가",
          description: "국토교통부 아파트 매매 실거래가 조회",
          tags: ["real-estate"],
          source_url: null,
          representation: "api_json",
          operations: ["list"],
          query_support: null,
          requires_service_key: true,
          request_parameters: [],
        },
        {
          name: "air_quality",
          title: "대기오염 측정망",
          description: "환경부 대기오염 측정망 시간자료",
          tags: ["environment"],
          source_url: null,
          representation: "api_json",
          operations: ["list"],
          query_support: null,
          requires_service_key: true,
          request_parameters: [
            { name: "sidoName", required: true, description: "조회할 시·도", example: "서울" },
          ],
          application: {
            required: true,
            url: "https://www.data.go.kr/data/15073861/openapi.do",
          },
        },
      ],
    },
  ],
};

/** GET /catalog — provider/dataset catalog (deterministic mock in mock mode). */
export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  if (!isRealBuilderEnabled()) return MOCK_CATALOG;
  return builderApi.catalog(signal);
}

/**
 * POST /providers/{provider}/test wrapper (#492). Generic Provider probe calls
 * any first Dataset without required parameters, so "connection success" is
 * unreliable and was removed from Add Data user flow (#S-provider-probe). Builder
 * contract is maintained, so the wrapper itself is kept (for direct diagnostics).
 * Mock mode always returns connected.
 */
export async function testProvider(provider: string, signal?: AbortSignal): Promise<ProviderTestResponse> {
  if (!isRealBuilderEnabled()) {
    return { provider, status: "connected", configured: true, latency_ms: 42, checked_at: new Date().toISOString() };
  }
  return builderApi.testProviderConnection(provider, signal);
}

/**
 * Extracts only "effective credential configuration status" per provider from
 * GET /providers summary (#S-add-data). Add Data credential prerequisite reuses
 * this value as the authoritative source — `configured` is an effective value
 * reflecting user credential > server default > none (ADR 0012), and Studio does
 * not independently infer credential existence. Mock mode treats as always
 * connected/configured (like testProvider above) to avoid blocking remaining
 * mock flow without network — prerequisite UX itself is verified via component
 * test that directly injects `providerConfigured` prop to `ConfigureStep`.
 */
export async function fetchProviderConfigured(signal?: AbortSignal): Promise<Record<string, boolean>> {
  if (!isRealBuilderEnabled()) return { datago: true };
  const response = await builderApi.listProviders(signal);
  return Object.fromEntries(response.providers.map((p) => [p.provider, p.configured]));
}

/**
 * File source upload for kind="file" (#498). Mock mode does not read actual file
 * content; instead creates deterministic upload_id and returns immediately (browser
 * principle: file content is not held as separate canonical copy — so this also
 * does not read content).
 */
export async function uploadSourceFile(
  file: File,
  format: SourceFormat,
  signal?: AbortSignal,
): Promise<UploadMetadata> {
  if (!isRealBuilderEnabled()) {
    return {
      upload_id: "upl_00000000000000000000000000000000",
      format,
      encoding: "utf-8",
      size_bytes: file.size,
      original_filename: file.name,
      created_at: new Date().toISOString(),
    };
  }
  const bytes = await file.arrayBuffer();
  return builderApi.uploadFile(bytes, { format, filename: file.name }, signal);
}
