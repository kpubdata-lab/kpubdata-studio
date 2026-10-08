/**
 * The Add Data client: one interface, and the two things that implement it (#794).
 *
 * As in `features/datasets/api/client.ts`: the workbench asks `addDataClient()` and does
 * not know whether a Builder or the demo answers. `client.contract.test.ts` holds the two
 * to the same expectations. What is the demo's own, and written down:
 *
 * - a connection test always answers `connected`, and every provider is configured: the
 *   demo has no key to be missing;
 * - an upload is not read and gets one fixed `upload_id` — the file's content never
 *   leaves the browser in the demo;
 * - its catalogue is not the one the Catalog screen's demo shows
 *   (`features/discover/client.ts`): two fixtures answer the same `GET /catalog`.
 */
import {
  builderApi,
  isRealBuilderEnabled,
  type CatalogResponse,
  type ProviderTestResponse,
  type ProvidersResponse,
  type UploadMetadata,
} from "@/shared/lib/builderApi";
import type { SourceFormat } from "@/shared/lib/types";

/**
 * What the Add Data workbench asks for. Every method resolves with the response as
 * Builder's contract shapes it and rejects, without an answer, when `signal` is already
 * aborted.
 */
export interface AddDataClient {
  /** `GET /catalog` — the providers and datasets a source can be picked from. */
  catalog(signal?: AbortSignal): Promise<CatalogResponse>;
  /** `GET /providers` — which providers there are and whether a credential is in effect. */
  providers(signal?: AbortSignal): Promise<ProvidersResponse>;
  /** `POST /providers/{provider}/test` — a connection test (#492). Kept for diagnostics. */
  testProvider(provider: string, signal?: AbortSignal): Promise<ProviderTestResponse>;
  /** `POST /uploads` — the file of a `kind: file` source (#498). */
  uploadFile(file: File, format: SourceFormat, signal?: AbortSignal): Promise<UploadMetadata>;
}

export const realAddDataClient: AddDataClient = {
  catalog: async (signal) => builderApi.catalog(signal),
  providers: async (signal) => builderApi.listProviders(signal),
  testProvider: async (provider, signal) => builderApi.testProviderConnection(provider, signal),
  uploadFile: async (file, format, signal) =>
    builderApi.uploadFile(await file.arrayBuffer(), { format, filename: file.name }, signal),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

const DEMO_CATALOG: CatalogResponse = {
  providers: [
    {
      name: "datago",
      datasets: [
        {
          name: "apt_trade",
          title: "아파트 실거래가",
          description: null,
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
          description: null,
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

export const demoAddDataClient: AddDataClient = {
  async catalog(signal) {
    throwIfAborted(signal);
    return DEMO_CATALOG;
  },
  async providers(signal) {
    throwIfAborted(signal);
    return {
      providers: DEMO_CATALOG.providers.map((provider) => ({
        provider: provider.name,
        requires_credential: provider.datasets.some((dataset) => dataset.requires_service_key),
        configured: true,
      })),
    };
  },
  async testProvider(provider, signal) {
    throwIfAborted(signal);
    return { provider, status: "connected", configured: true, latency_ms: 42, checked_at: new Date().toISOString() };
  },
  async uploadFile(file, format, signal) {
    throwIfAborted(signal);
    return {
      upload_id: "upl_00000000000000000000000000000000",
      format,
      encoding: "utf-8",
      size_bytes: file.size,
      original_filename: file.name,
      created_at: new Date().toISOString(),
    };
  },
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function addDataClient(): AddDataClient {
  return isRealBuilderEnabled() ? realAddDataClient : demoAddDataClient;
}
