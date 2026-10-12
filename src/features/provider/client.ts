/**
 * The connections client: one interface, a Builder and a demo behind it (#794, #902).
 *
 * The connections screen and the key probe ask `providerClient()` and do not know which
 * answers. What is the demo's own, and written down:
 *
 * - it has three providers (`DEMO_PROVIDERS`), whose list never changes, and no key
 *   store: saving or deleting a key
 *   changes nothing, and a provider's key reads as set when its summary says configured;
 * - a connection test answers `connected` for a provider that needs no key or has one,
 *   and `not_configured` otherwise;
 * - a key probe answers one of each outcome a user most often meets, whatever the key.
 */
import {
  builderApi,
  isRealBuilderEnabled,
  type ProviderCredentialResponse,
  type ProviderProbeResponse,
  type ProviderSummary,
  type ProviderTestResponse,
  type ProvidersResponse,
} from "@/shared/lib/builderApi";

export interface ProviderClient {
  /** `GET /providers` — every provider, with whether this user's key is set and its last test. */
  list(): Promise<ProvidersResponse>;
  /** `GET /providers/{provider}/credential` — whether this user saved a key. */
  credential(provider: string): Promise<ProviderCredentialResponse>;
  /** `PUT /providers/{provider}/credential`. */
  saveCredential(provider: string, credential: string): Promise<unknown>;
  /** `DELETE /providers/{provider}/credential`. */
  deleteCredential(provider: string): Promise<unknown>;
  /** `POST /providers/{provider}/test` — a connection test, remembered as `last_test`. */
  test(provider: string): Promise<ProviderTestResponse>;
  /** `POST /providers/{provider}/probe` — what the held key reaches, per dataset (#410). */
  probe(provider: string): Promise<ProviderProbeResponse>;
}

export const realProviderClient: ProviderClient = {
  list: () => builderApi.listProviders(),
  credential: (provider) => builderApi.getProviderCredential(provider),
  saveCredential: (provider, credential) => builderApi.putProviderCredential(provider, credential),
  deleteCredential: (provider) => builderApi.deleteProviderCredential(provider),
  test: (provider) => builderApi.testProviderConnection(provider),
  probe: (provider) => builderApi.probeProviderKey(provider),
};

/** The demo's providers, as `GET /providers` would list them. */
export const DEMO_PROVIDERS: ProviderSummary[] = [
  { provider: "datago", requires_credential: true, configured: false, last_test: null },
  {
    provider: "kosis",
    requires_credential: true,
    configured: true,
    last_test: {
      status: "connected",
      checked_at: "2026-09-01T09:30:00+09:00",
      error_category: null,
      response_code: null,
      dataset: null,
    },
  },
  { provider: "g2b", requires_credential: true, configured: false, last_test: null },
];

const demoProvider = (id: string) => DEMO_PROVIDERS.find((summary) => summary.provider === id);

export const demoProviderClient: ProviderClient = {
  list: async () => ({ providers: DEMO_PROVIDERS.map((summary) => ({ ...summary })) }),
  async credential(provider) {
    const configured = demoProvider(provider)?.configured ?? false;
    return {
      provider,
      configured,
      masked: configured ? "ab••••yz" : null,
      updated_at: configured ? new Date(Date.now() - 3600000).toISOString() : null,
    };
  },
  saveCredential: async () => undefined,
  deleteCredential: async () => undefined,
  async test(provider) {
    const summary = demoProvider(provider);
    const ready = !summary || !summary.requires_credential || summary.configured;
    return { provider, status: ready ? "connected" : "not_configured", configured: ready, latency_ms: 0, checked_at: new Date().toISOString() };
  },
  probe: async (provider) => ({
    provider,
    probed_at: "2026-10-06T09:30:00+00:00",
    complete: true,
    datasets: [
      { dataset: "apt_trade", service_id: "RTMSDataSvcAptTradeDev", status: "available", detail: "", http_status: 200 },
      { dataset: "apt_rent", service_id: "RTMSDataSvcAptRent", status: "application_required", detail: "", http_status: 200 },
    ],
    not_probed: [],
  }),
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function providerClient(): ProviderClient {
  return isRealBuilderEnabled() ? realProviderClient : demoProviderClient;
}
