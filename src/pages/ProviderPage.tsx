/**
 * Provider screen (`/provider`) — Provider Connection·Credential + Settings combined (#259).
 *
 * Issue #259: combines Provider credential/connection management with Settings.
 * Issue #538: providers are one table (`features/provider/ConnectionsTable`) —
 * Provider, Authentication, Configured, Last test, Action — and the credential panel
 * for the provider picked in it sits below. No key text, raw or masked, is in the table.
 *
 * Truthfulness principle (F01, builder ADR 0012):
 * - The `configured` flag in the GET /providers summary is the **effective provider
 *   configuration** (user credential > server default > none) — NOT "this user saved
 *   a credential".
 * - Whether "this user saved a credential", and its masked value, are determined
 *   ONLY by the GET /providers/{provider}/credential metadata
 *   (`{ configured, masked, updated_at }`, no raw secret).
 * - requires_credential=false can still show summary configured=true (auth-free
 *   provider).
 * - The screen keeps the two axes separate: (1) effective credential readiness
 *   (summary configured), (2) existence of a user-saved credential (the basis for
 *   masked value display and deletion).
 * - The generic Provider probe (`POST /providers/{provider}/test`,
 *   `GET .../status`) is unreliable — it calls an arbitrary first Dataset without
 *   required parameters. This screen never surfaces probe results as "connection
 *   success"; actual usability is confirmed by Previewing a chosen Dataset
 *   (#S-provider-probe).
 */
import { useTranslation } from "react-i18next";
import { ApplicationGuideCard } from "@/features/onboarding/ApplicationGuideCard";
import { i18n } from "@/shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type ProviderSummary,
} from "@/shared/lib/builderApi";
import {
  Card,
  Button,
  LinkButton,
  PageHeader,
  EmptyState,
  Skeleton,
} from "@/shared/ui";
import { describeCredentialReadiness } from "@/shared/lib/providerStatus";
import { ConnectionsTable } from "@/features/provider/ConnectionsTable";

/**
 * Trust the `returnTo` query param only when it is a safe internal path
 * (#S-add-data, §4). Blocks open redirects to absolute/protocol-relative
 * (`//evil.com`) paths — the value is only ever a safe resume point for internal
 * screens like Add Data.
 */
export function isSafeReturnTo(value: string | null): value is string {
  if (!value) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  return true;
}

interface ProviderConfig {
  id: string;
  /** Whether this provider requires a user credential (GET /providers). */
  requiresCredential: boolean;
  /**
   * The `configured` flag from the GET /providers summary — the effective
   * provider configuration (user credential > server default > none), not
   * whether the user saved a credential.
   */
  summaryConfigured: boolean;
}

interface CredentialForm {
  credential: string;
}

/**
 * "User-saved credential" metadata state for the selected provider.
 * `configured` follows the GET /providers/{provider}/credential response
 * (whether this user personally saved one).
 */
type CredentialMetaState =
  | { status: "idle" | "loading" }
  | { status: "not_applicable" }
  /**
   * The operator has not configured the encrypted credential store (master
   * key) — Builder answered `GET /providers/{provider}/credential` with 503
   * `credential store is not configured`. Distinguished from "user has not
   * registered a credential yet" (200 `configured:false`) and ordinary fetch
   * failures.
   */
  | { status: "store_unavailable" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      configured: boolean;
      masked: string | null;
      updatedAt: string | null;
    };

/** Classify only Builder's explicit store-not-configured response as operator remediation. */
export function isCredentialStoreUnavailable(cause: unknown): boolean {
  if (!(cause instanceof ApiError) || cause.status !== 503) return false;
  if (!cause.details || typeof cause.details !== "object" || Array.isArray(cause.details)) return false;
  return (cause.details as { error?: unknown }).error === "credential store is not configured";
}

/** Convert the Builder GET /providers summary to a screen model (connection state filled by a separate status check). */
function mapProviderSummary(summary: ProviderSummary): ProviderConfig {
  return {
    id: summary.provider,
    requiresCredential: summary.requires_credential,
    summaryConfigured: summary.configured,
  };
}

export function ProviderPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  // Arrived from Add Data etc. via `?provider=datago&returnTo=/add`
  // (#S-add-data, §4). The URL carries only a provider id and a safe return
  // destination — never credentials or a BuildSpec. providerParam is used
  // exactly once for auto-selection after the list loads.
  const providerParam = searchParams.get("provider");
  const returnToParam = searchParams.get("returnTo");
  const safeReturnTo = isSafeReturnTo(returnToParam) ? returnToParam : null;
  const providerParamAppliedRef = useRef(false);

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [credentialForm, setCredentialForm] = useState<CredentialForm>({ credential: "" });
  const [credentialMeta, setCredentialMeta] = useState<CredentialMetaState>({ status: "idle" });
  // Whether a credential was saved during this visit — the returnTo CTA
  // shows only after a successful save (§4). Reset on provider switch.
  const [justSavedCredential, setJustSavedCredential] = useState(false);
  // The credential meta fetch/update race guard watches two axes together:
  // (1) request-generation — a fetch started later always wins.
  // (2) selectedProviderIdRef — the fetch's target provider must equal the
  //     provider selected on screen right now. A late loadCredentialMeta(A)
  //     after a mutation (save/delete) may raise the generation to newest, but
  //     if the user moved to B meanwhile, A's result/loading/error can never
  //     overwrite the B panel (#324, #322).
  const credentialRequestGeneration = useRef(0);
  const selectedProviderIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isRealBuilderEnabled()) {
        // real mode: GET /providers is the canonical source. Never disguise
        // failure as mock success — the catch falls through to an explicit
        // error/empty list (#S01).
        const response = await builderApi.listProviders();
        const mapped = response.providers.map(mapProviderSummary);
        setProviders(mapped);
        // The ref is the synchronous source of truth for user selection.
        // State updaters/effects run late; flipping an already-B ref back to A
        // could start a stale mutation refresh — so the list response never
        // re-decides the selection. Only if it disappeared from the actual list
        // is the selection explicitly cleared.
        const selectedId = selectedProviderIdRef.current;
        const next = selectedId ? mapped.find((provider) => provider.id === selectedId) : undefined;
        if (!next) {
          if (selectedId) selectedProviderIdRef.current = null;
          setSelectedProvider(null);
        } else {
          setSelectedProvider(next);
        }
      } else {
        // Use the mock list only in explicit mock/demo mode.
        setProviders(getMockProviders());
      }
    } catch {
      setError(i18n.t("provider.errors.loadProvider"));
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  /**
   * Authoritatively re-reads the "user-saved credential" metadata for the
   * selected provider. Skips the fetch entirely when
   * requires_credential=false (nothing to register or delete).
   */
  const loadCredentialMeta = useCallback(
    async (provider: ProviderConfig) => {
      const generation = ++credentialRequestGeneration.current;
      // Whether this fetch's result may reach the screen: only when it is
      // the latest fetch AND its target is still the selected provider.
      // Always checked before committing loading/error/loaded.
      const stillCurrent = () =>
        generation === credentialRequestGeneration.current &&
        provider.id === selectedProviderIdRef.current;
      if (!provider.requiresCredential) {
        if (stillCurrent()) setCredentialMeta({ status: "not_applicable" });
        return;
      }
      if (stillCurrent()) setCredentialMeta({ status: "loading" });
      try {
        if (isRealBuilderEnabled()) {
          const meta = await builderApi.getProviderCredential(provider.id);
          if (!stillCurrent()) return;
          setCredentialMeta({
            status: "loaded",
            configured: meta.configured,
            masked: meta.masked,
            updatedAt: meta.updated_at,
          });
        } else {
          if (!stillCurrent()) return;
          setCredentialMeta(mockCredentialMeta(provider));
        }
      } catch (cause) {
        if (!stillCurrent()) return;
        if (isCredentialStoreUnavailable(cause)) {
          setCredentialMeta({ status: "store_unavailable" });
          return;
        }
        setCredentialMeta({ status: "error", message: i18n.t("provider.errors.credStatus") });
      }
    },
    [],
  );

  const handleProviderSelect = (provider: ProviderConfig) => {
    // Selection changes are reflected in the ref synchronously — the
    // immediately following loadCredentialMeta must key off this value, and
    // any in-flight fetch for another provider is stale from this point on.
    selectedProviderIdRef.current = provider.id;
    ++credentialRequestGeneration.current;
    setSelectedProvider(provider);
    setShowCredentialForm(false);
    setCredentialForm({ credential: "" });
    setJustSavedCredential(false);
    void loadCredentialMeta(provider);
  };

  // When arrived with `?provider=`, auto-select that provider exactly
  // once after the list loads (#S-add-data, §4) — same pattern as Discover's
  // catalog preselection (applied once; quietly skipped if absent).
  useEffect(() => {
    if (providerParamAppliedRef.current || loading || !providerParam) return;
    providerParamAppliedRef.current = true;
    const match = providers.find((p) => p.id === providerParam);
    if (match) handleProviderSelect(match);
  }, [providers, loading, providerParam]);

  const handleCredentialSubmit = async () => {
    if (!selectedProvider || !credentialForm.credential) return;
    if (!selectedProvider.requiresCredential) return;
    const provider = selectedProvider;
    setError(null);
    try {
      if (isRealBuilderEnabled()) {
        // PUT /providers/{provider}/credential; body is only
        // { credential }. The plaintext is not expected back in the response,
        // and the URL uses the selected provider's canonical id (#S02).
        await builderApi.putProviderCredential(provider.id, credentialForm.credential);
      }
      // If the user moved to another provider while the save was in flight,
      // this mutation's follow-up form reset/error must not pollute the
      // current screen (B) — same axis as #322/#324.
      if (selectedProviderIdRef.current === provider.id) {
        setCredentialForm({ credential: "" });
        setShowCredentialForm(false);
        setJustSavedCredential(true);
      }
      // Refresh the list authoritatively, but do not start A's
      // provider-specific refresh while viewing another provider — starting
      // it would raise the global generation and could stale B's pending GET.
      await loadProviders();
      if (selectedProviderIdRef.current === provider.id) {
        await loadCredentialMeta(provider);
      }
    } catch (cause) {
      if (selectedProviderIdRef.current !== provider.id) return;
      setError(
        isCredentialStoreUnavailable(cause)
          ? i18n.t("provider.errors.saveNoStore")
          : i18n.t("provider.errors.saveFail"),
      );
    }
  };

  const handleCredentialDelete = async () => {
    if (!selectedProvider) return;
    const provider = selectedProvider;
    setError(null);
    try {
      if (isRealBuilderEnabled()) {
        await builderApi.deleteProviderCredential(provider.id);
      }
      // Same as save: no metadata refresh for a provider the user left.
      await loadProviders();
      if (selectedProviderIdRef.current === provider.id) {
        await loadCredentialMeta(provider);
      }
    } catch (cause) {
      // If the user moved to another provider mid-delete, do not surface
      // this failure on the current screen.
      if (selectedProviderIdRef.current !== provider.id) return;
      setError(
        isCredentialStoreUnavailable(cause)
          ? i18n.t("provider.errors.deleteNoStore")
          : i18n.t("provider.errors.deleteFail"),
      );
    }
  };

  // Whether the user personally saved a credential (the sole basis for the
  // delete button and masked-value display).
  const userCredentialConfigured =
    credentialMeta.status === "loaded" && credentialMeta.configured;

  // Readiness of the selected provider, now that this user's own key is known. It is
  // credential readiness, not a generic live probe (#S-provider-probe); Preview
  // confirms that a dataset actually works. The table only knows the summary.
  const selectedReadiness = selectedProvider
    ? describeCredentialReadiness({
        requiresCredential: selectedProvider.requiresCredential,
        summaryConfigured: selectedProvider.summaryConfigured,
        userCredentialConfigured,
      })
    : null;
  const canRegisterCredential =
    !!selectedProvider &&
    selectedProvider.requiresCredential &&
    credentialMeta.status === "loaded";

  return (
    <main className="flex flex-1 flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        title={t("provider.page.title")}
        description={t("provider.page.desc")}
        actions={<LinkButton to="/settings">{t("provider.page.settings")}</LinkButton>}
      />
      <p className="-mt-6 text-xs text-muted-foreground">
        {t("provider.page.note")}
      </p>

      {safeReturnTo ? (
        <Card variant="dashed" className="text-sm">
          {t("provider.page.cta")}
        </Card>
      ) : null}

      {error && (
        <Card variant="error">
          <p className="font-semibold">{error}</p>
        </Card>
      )}

      <section aria-labelledby="connections-title" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground" id="connections-title">
          {t("provider.page.headerTitle")}
        </h2>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : providers.length === 0 ? (
          <Card>
            <EmptyState
              title={t("provider.page.emptyTitle")}
              description={t("provider.page.emptyDesc")}
            />
          </Card>
        ) : (
          <ConnectionsTable
            onSelect={(id) => {
              const provider = providers.find((candidate) => candidate.id === id);
              if (provider) handleProviderSelect(provider);
            }}
            rows={providers}
            selectedId={selectedProvider?.id ?? null}
          />
        )}
        <p className="text-xs text-muted-foreground">{t("provider.table.lastTestNote")}</p>
      </section>

      {selectedProvider ? (
        <section aria-labelledby="credential-title" className="flex flex-col gap-2">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground" id="credential-title">
                      {t("provider.detail.credTitle")} — <span className="font-mono">{selectedProvider.id}</span>
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{selectedReadiness?.label}</span>
                      {" — "}
                      {selectedReadiness?.detail}
                    </p>
                  </div>
                  {userCredentialConfigured ? (
                    <Button size="sm" variant="danger" onClick={handleCredentialDelete}>
                      {t("provider.detail.delete")}
                    </Button>
                  ) : canRegisterCredential && !showCredentialForm ? (
                    <Button size="sm" onClick={() => setShowCredentialForm(true)}>
                      {selectedProvider.summaryConfigured ? t("provider.detail.registered") : t("provider.detail.register")}
                    </Button>
                  ) : null}
                </div>

                {!selectedProvider.requiresCredential ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("provider.detail.noCredNote")}
                  </p>
                ) : credentialMeta.status === "loading" || credentialMeta.status === "idle" ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("provider.detail.loading")}
                  </p>
                ) : credentialMeta.status === "store_unavailable" ? (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {t("provider.detail.noStoreTitle")}
                    </p>
                    <p className="mt-2">
                      {t("provider.detail.noStoreBody")}
                    </p>
                  </div>
                ) : credentialMeta.status === "error" ? (
                  <p className="mt-4 text-sm text-status-failure">
                    {credentialMeta.message}
                  </p>
                ) : showCredentialForm ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2" htmlFor="provider-credential-input">{t("labels.apiKey")}</label>
                      <input
                        autoComplete="off"
                        id="provider-credential-input"
                        type="password"
                        className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                        placeholder={t("provider.detail.keyPlaceholder")}
                        value={credentialForm.credential}
                        onChange={(e) =>
                          setCredentialForm({ ...credentialForm, credential: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleCredentialSubmit}
                        disabled={!credentialForm.credential}
                      >
                        {t("provider.detail.save")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setShowCredentialForm(false);
                          setCredentialForm({ credential: "" });
                        }}
                      >
                        {t("provider.detail.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : credentialMeta.status === "loaded" && credentialMeta.configured ? (
                  <div className="mt-4">
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">{t("provider.detail.savedKey")}</span>{" "}
                      {credentialMeta.masked ?? t("provider.detail.configured")}
                    </div>
                    {credentialMeta.updatedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("provider.detail.lastUpdated")}{" "}
                        {new Date(credentialMeta.updatedAt).toLocaleString("ko-KR")}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("provider.detail.maskingNote")}
                    </p>
                    {justSavedCredential && safeReturnTo ? (
                      <div className="mt-4">
                        <LinkButton to={safeReturnTo}>{t("provider.detail.backToData")}</LinkButton>
                      </div>
                    ) : null}
                  </div>
                ) : selectedProvider.summaryConfigured ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("provider.detail.defaultCredNote")}
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("provider.detail.needsCredNote")}
                  </p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  {t("provider.detail.scopeNote")}
                </p>
              </Card>
        </section>
      ) : null}

      <ApplicationGuideCard />
    </main>
  );
}

/** Simulates the selected provider's user-credential state in mock/demo mode. */
function mockCredentialMeta(provider: ProviderConfig): CredentialMetaState {
  if (!provider.requiresCredential) return { status: "not_applicable" };
  const configured = provider.summaryConfigured;
  return {
    status: "loaded",
    configured,
    masked: configured ? "ab••••yz" : null,
    updatedAt: configured ? new Date(Date.now() - 3600000).toISOString() : null,
  };
}

function getMockProviders(): ProviderConfig[] {
  return [
    {
      id: "datago",
      requiresCredential: true,
      summaryConfigured: false,
    },
    {
      id: "kosis",
      requiresCredential: true,
      summaryConfigured: true,
    },
    {
      id: "g2b",
      requiresCredential: true,
      summaryConfigured: false,
    },
  ];
}
