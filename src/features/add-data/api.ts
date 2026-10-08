/**
 * Thin wrapper around Builder API used by Add Data Workbench (#250).
 *
 * Each function asks the client in force (`./client`): Builder's when one is configured,
 * the demo's otherwise. Which of the two answers is decided there and nowhere in this
 * file (#794); what is left here is the slight reshaping the screen wants.
 */
import type { CatalogResponse, ProviderTestResponse, UploadMetadata } from "@/shared/lib/builderApi";
import type { SourceFormat } from "@/shared/lib/types";
import { addDataClient } from "./client";

/** GET /catalog — provider/dataset catalog. */
export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  return addDataClient().catalog(signal);
}

/**
 * POST /providers/{provider}/test wrapper (#492). Generic Provider probe calls arbitrary first
 * Dataset without required params, unreliable for "connection success" and removed from Add Data user flow (#S-provider-probe).
 * Builder contract maintained so wrapper kept for direct diagnostics. The demo always answers connected.
 */
export async function testProvider(provider: string, signal?: AbortSignal): Promise<ProviderTestResponse> {
  return addDataClient().testProvider(provider, signal);
}

/**
 * GET /providers extracts only per-provider "effective credential configured" from summary (#S-add-data).
 * Add Data credential prerequisite reuses this as authoritative source — configured reflects user credential > server default > none
 * (ADR 0012), Studio doesn't independently infer credential existence. The demo answers configured for its providers, so the demo
 * flow is not blocked — prerequisite UX itself verified by component test injecting providerConfigured prop directly to ConfigureStep.
 */
export async function fetchProviderConfigured(signal?: AbortSignal): Promise<Record<string, boolean>> {
  const response = await addDataClient().providers(signal);
  return Object.fromEntries(response.providers.map((p) => [p.provider, p.configured]));
}

/**
 * kind="file" source upload (#498). The demo doesn't read actual file content and answers one deterministic upload_id
 * (browser principle: file content not stored separately in canonical — not read there either).
 */
export async function uploadSourceFile(
  file: File,
  format: SourceFormat,
  signal?: AbortSignal,
): Promise<UploadMetadata> {
  return addDataClient().uploadFile(file, format, signal);
}
