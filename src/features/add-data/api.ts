/**
 * Thin wrapper around Builder API used by Add Data Workbench (#250).
 *
 * Reuses client from shared/lib/builderApi.ts as-is without reimplementing new endpoints.
 * Work here is only (1) mock/real branching, (2) slight response reshaping for screen consumption.
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

/** GET /catalog — provider/dataset catalog (mock mode uses deterministic mock). */
export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  if (!isRealBuilderEnabled()) return MOCK_CATALOG;
  return builderApi.catalog(signal);
}

/**
 * POST /providers/{provider}/test wrapper (#492). Generic Provider probe calls arbitrary first
 * Dataset without required params, unreliable for "connection success" and removed from Add Data user flow (#S-provider-probe).
 * Builder contract maintained so wrapper kept for direct diagnostics. Mock mode always returns connected.
 */
export async function testProvider(provider: string, signal?: AbortSignal): Promise<ProviderTestResponse> {
  if (!isRealBuilderEnabled()) {
    return { provider, status: "connected", configured: true, latency_ms: 42, checked_at: new Date().toISOString() };
  }
  return builderApi.testProviderConnection(provider, signal);
}

/**
 * GET /providers extracts only per-provider "effective credential configured" from summary (#S-add-data).
 * Add Data credential prerequisite reuses this as authoritative source — configured reflects user credential > server default > none
 * (ADR 0012), Studio doesn't independently infer credential existence. Mock mode treats as always connected/configured like testProvider above
 * to not block mock flow without network — prerequisite UX itself verified by component test injecting providerConfigured prop directly to ConfigureStep.
 */
export async function fetchProviderConfigured(signal?: AbortSignal): Promise<Record<string, boolean>> {
  if (!isRealBuilderEnabled()) return { datago: true };
  const response = await builderApi.listProviders(signal);
  return Object.fromEntries(response.providers.map((p) => [p.provider, p.configured]));
}

/**
 * kind="file" source upload (#498). Mock mode doesn't read actual file content, generates deterministic upload_id
 * immediately (browser principle: file content not stored separately in canonical — not read here either).
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
