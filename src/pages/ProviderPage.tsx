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
 * - `POST /providers/{provider}/test` is reliable since kpubdata-builder#842: it calls a
 *   dataset whose required parameters are declared and that needs no application, and
 *   answers `not_testable` when there is none. Each row has a Test action, and the
 *   principal's `last_test` from GET /providers fills the Last test column. It is still a
 *   provider-level check; a chosen Dataset's usability is confirmed by its Preview
 *   (#S-provider-probe). `GET .../status` is not used.
 *
 * Multi-user deployment (#652, kpubdata-builder#683, contract 1.56.0): Builder stores no
 * provider key — `PUT .../credential` answers 403 `credential_storage_disabled` — and wants
 * the key with each request in `X-Provider-Key`. The contract has no provider-specific mode
 * signal, but `GET /version`'s `publish_credential` is `request` exactly in a multi-user
 * deployment (both follow builder's `multi_user_mode()`), so that value — or, from a
 * Builder that does not say, the 403 itself — switches this panel from "save" to "use
 * for this session": the key is held in memory only (`shared/lib/providerKeys`) and the
 * Builder calls that need it carry it. A single-user deployment is unchanged.
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
  type ProviderLastTest,
  type ProviderSummary,
  type ProviderTestResponse,
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
import {
  forgetProviderKey,
  holdProviderKey,
  useProviderKeyHeld,
} from "@/shared/lib/providerKeys";
import { ConnectionsTable } from "@/features/provider/ConnectionsTable";
import { KeyProbePanel } from "@/features/provider/KeyProbePanel";
import { ensureVersionChecked, useVersionCheckStore } from "@/features/version-check/store";

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
  /** `last_test` from GET /providers; `undefined` when the Builder does not send it. */
  lastTest?: ProviderLastTest | null;
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

/**
 * Builder's refusal to store a provider key (#652, contract 1.56.0): a multi-user
 * deployment takes keys only per request, in `X-Provider-Key`.
 */
export function isCredentialStorageDisabled(cause: unknown): boolean {
  if (!(cause instanceof ApiError) || cause.status !== 403) return false;
  if (!cause.details || typeof cause.details !== "object" || Array.isArray(cause.details)) return false;
  return (cause.details as { code?: unknown }).code === "credential_storage_disabled";
}

/** Convert the Builder GET /providers summary to a screen model (connection state filled by a separate status check). */
function mapProviderSummary(summary: ProviderSummary): ProviderConfig {
  return {
    id: summary.provider,
    requiresCredential: summary.requires_credential,
    summaryConfigured: summary.configured,
    lastTest: summary.last_test,
  };
}

/** The test result as the `last_test` Builder now remembers for this principal (#842). */
export function lastTestFromResponse(response: ProviderTestResponse): ProviderLastTest {
  return {
    status: response.status,
    checked_at: response.checked_at,
    error_category: response.error_category ?? null,
    response_code: response.response_code ?? null,
    dataset: response.dataset ?? null,
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
  // The provider whose line in the list is older than a delete of its key, and whether
  // the list is being read again or could not be. The list's `configured` may have been
  // true only for the key that was deleted, so it says nothing until read again (#845).
  const [staleSummary, setStaleSummary] = useState<{ provider: string; reread: "reading" | "failed" } | null>(null);
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
  const [testingId, setTestingId] = useState<string | null>(null);
  // Builder refused to store a key (403 `credential_storage_disabled`) — the fallback
  // signal when `GET /version` does not say where keys come from.
  const [storageRefused, setStorageRefused] = useState(false);
  // `request` ⇔ multi-user deployment (see the module comment), where keys are per request.
  const deploymentCredentialSource = useVersionCheckStore((state) => state.publishCredential);
  const keysPerRequest = deploymentCredentialSource === "request" || storageRefused;
  const selectedKeyHeld = useProviderKeyHeld(selectedProvider?.id);

  useEffect(() => {
    if (isRealBuilderEnabled()) void ensureVersionChecked();
  }, []);

  const loadProviders = useCallback(async (): Promise<boolean> => {
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
        // Every line of the list is as new as this answer.
        setStaleSummary(null);
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
      return true;
    } catch {
      setError(i18n.t("provider.errors.loadProvider"));
      setProviders([]);
      return false;
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
    async (provider: ProviderConfig, options: { afterMutation?: boolean } = {}) => {
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
      // After a save or a delete the panel already shows what that did (#845). Going
      // back to "loading" for the confirming read would make it say, for as long as the
      // read takes, that the Builder's default credential is in use.
      if (stillCurrent() && !options.afterMutation) setCredentialMeta({ status: "loading" });
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
        // The save or delete itself succeeded; a confirming read that fails does not
        // undo it, and what the panel shows stays.
        if (options.afterMutation) return;
        if (isCredentialStoreUnavailable(cause)) {
          setCredentialMeta({ status: "store_unavailable" });
          return;
        }
        setCredentialMeta({ status: "error", message: i18n.t("provider.errors.credStatus") });
      }
    },
    [],
  );

  /**
   * Runs one provider's connection test and shows its result as that row's last test.
   * Builder stores the same result, so the next GET /providers agrees with it.
   */
  const handleProviderTest = async (id: string) => {
    setTestingId(id);
    setError(null);
    try {
      const provider = providers.find((candidate) => candidate.id === id);
      const lastTest = isRealBuilderEnabled()
        ? lastTestFromResponse(await builderApi.testProviderConnection(id))
        : mockLastTest(provider);
      const apply = (candidate: ProviderConfig) =>
        candidate.id === id ? { ...candidate, lastTest } : candidate;
      setProviders((current) => current.map(apply));
      setSelectedProvider((current) => (current ? apply(current) : current));
    } catch {
      setError(i18n.t("provider.errors.testFail", { provider: id }));
    } finally {
      setTestingId(null);
    }
  };

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

  /**
   * Hold the typed key for this page load instead of storing it (multi-user deployment).
   * Nothing is sent now; the Builder calls that need it carry it in `X-Provider-Key`.
   */
  const handleUseKeyForSession = () => {
    if (!selectedProvider || !selectedProvider.requiresCredential) return;
    setError(null);
    if (!holdProviderKey(selectedProvider.id, credentialForm.credential)) {
      setError(i18n.t("provider.errors.keyUnsupported"));
      return;
    }
    setCredentialForm({ credential: "" });
    setShowCredentialForm(false);
    setJustSavedCredential(true);
  };

  const handleForgetSessionKey = () => {
    if (!selectedProvider) return;
    forgetProviderKey(selectedProvider.id);
    setJustSavedCredential(false);
  };

  const handleCredentialSubmit = async () => {
    if (!selectedProvider || !credentialForm.credential) return;
    if (!selectedProvider.requiresCredential) return;
    if (keysPerRequest) {
      handleUseKeyForSession();
      return;
    }
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
        // The save succeeded, so this user's key is what the provider uses from now —
        // said at once, not after the two reads below (#845). Its masked form and
        // time come with the confirming read.
        ++credentialRequestGeneration.current;
        setCredentialMeta({ status: "loaded", configured: true, masked: null, updatedAt: null });
      }
      // Refresh the list authoritatively, but do not start A's
      // provider-specific refresh while viewing another provider — starting
      // it would raise the global generation and could stale B's pending GET.
      await loadProviders();
      if (selectedProviderIdRef.current === provider.id) {
        await loadCredentialMeta(provider, { afterMutation: true });
      }
    } catch (cause) {
      if (isCredentialStorageDisabled(cause)) {
        // Multi-user deployment: keep the typed key in the open form so the next action —
        // use it for this session — is one click away. Nothing was stored.
        setStorageRefused(true);
        if (selectedProviderIdRef.current === provider.id) {
          setError(i18n.t("provider.errors.saveStorageDisabled"));
        }
        return;
      }
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
      if (selectedProviderIdRef.current === provider.id) {
        // Deleted, so this user has no key of their own here any more (#845). Whether a
        // default key is left is the list's to say, once it has been read again.
        ++credentialRequestGeneration.current;
        setCredentialMeta({ status: "loaded", configured: false, masked: null, updatedAt: null });
        setStaleSummary({ provider: provider.id, reread: "reading" });
      }
      // Same as save: no metadata refresh for a provider the user left.
      const listRead = await loadProviders();
      setStaleSummary((stale) =>
        stale?.provider !== provider.id ? stale : listRead ? null : { provider: provider.id, reread: "failed" },
      );
      if (selectedProviderIdRef.current === provider.id) {
        await loadCredentialMeta(provider, { afterMutation: true });
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
  // In a multi-user deployment nothing is stored, so a key held for this session is the
  // user's own key.
  const userCredentialConfigured = keysPerRequest
    ? selectedKeyHeld
    : credentialMeta.status === "loaded" && credentialMeta.configured;

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
  // The list's line for this provider, unless a delete has made it older than the truth.
  const summaryReread = staleSummary && staleSummary.provider === selectedProvider?.id ? staleSummary.reread : null;
  // "The Builder's default credential is in use" takes two things to say: that this user
  // has no key of their own here, and that the list still calls the provider configured.
  // Until this provider's own state is read the first is a guess; after a delete, until
  // the list is read again, the second is (#845). Without a credential store there can be
  // no key of the user's, so that state is known too. Nothing else the readiness line
  // says depends on either.
  const wouldSayDefaultKey =
    !!selectedProvider &&
    selectedProvider.requiresCredential &&
    selectedProvider.summaryConfigured &&
    !userCredentialConfigured;
  const ownCredentialKnown =
    keysPerRequest ||
    credentialMeta.status === "loaded" ||
    credentialMeta.status === "not_applicable" ||
    credentialMeta.status === "store_unavailable";
  const credentialOwnerKnown = !wouldSayDefaultKey || (ownCredentialKnown && summaryReread === null);
  // After a delete even "ready" comes from the old line of the list.
  const readinessKnown = !wouldSayDefaultKey || summaryReread === null;
  const canRegisterCredential =
    !!selectedProvider &&
    selectedProvider.requiresCredential &&
    credentialMeta.status === "loaded";

  return (
    <div className="flex flex-1 flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
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
            onTest={(id) => void handleProviderTest(id)}
            rows={providers}
            selectedId={selectedProvider?.id ?? null}
            testingId={testingId}
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
                    {readinessKnown ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{selectedReadiness?.label}</span>
                        {credentialOwnerKnown ? (
                          <>
                            {" — "}
                            {selectedReadiness?.detail}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  {keysPerRequest ? null : userCredentialConfigured ? (
                    <Button size="sm" variant="danger" onClick={handleCredentialDelete}>
                      {t("provider.detail.delete")}
                    </Button>
                  ) : canRegisterCredential && !showCredentialForm ? (
                    <Button size="sm" onClick={() => setShowCredentialForm(true)}>
                      {selectedProvider.summaryConfigured && summaryReread === null
                        ? t("provider.detail.registered")
                        : t("provider.detail.register")}
                    </Button>
                  ) : null}
                </div>

                {!selectedProvider.requiresCredential ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("provider.detail.noCredNote")}
                  </p>
                ) : keysPerRequest ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">{t("provider.detail.perRequestTitle")}</p>
                      <p className="mt-2">{t("provider.detail.perRequestBody")}</p>
                    </div>
                    {selectedKeyHeld ? (
                      <>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-foreground">{t("provider.detail.sessionKeyHeld")}</span>
                        <Button size="sm" variant="secondary" onClick={handleForgetSessionKey}>
                          {t("provider.detail.forgetSessionKey")}
                        </Button>
                        {justSavedCredential && safeReturnTo ? (
                          <LinkButton to={safeReturnTo}>{t("provider.detail.backToData")}</LinkButton>
                        ) : null}
                      </div>
                      {/* Keyed by provider: another provider's result never shows here. */}
                      <KeyProbePanel key={selectedProvider.id} provider={selectedProvider.id} />
                      </>
                    ) : showCredentialForm ? (
                      <div className="space-y-4">
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
                            onClick={handleUseKeyForSession}
                            disabled={!credentialForm.credential}
                          >
                            {t("provider.detail.useForSession")}
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
                    ) : (
                      <Button size="sm" onClick={() => setShowCredentialForm(true)}>
                        {t("provider.detail.enterSessionKey")}
                      </Button>
                    )}
                  </div>
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
                ) : summaryReread === "reading" ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("provider.detail.loading")}
                  </p>
                ) : summaryReread === "failed" ? (
                  <p className="mt-4 text-sm text-status-failure">
                    {t("provider.errors.credStatus")}
                  </p>
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
    </div>
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

/** Mock/demo mode has no Builder to call: a configured provider connects, others need a key. */
function mockLastTest(provider: ProviderConfig | undefined): ProviderLastTest {
  const ready = !provider || !provider.requiresCredential || provider.summaryConfigured;
  return {
    status: ready ? "connected" : "not_configured",
    checked_at: new Date().toISOString(),
    error_category: null,
    response_code: null,
    dataset: null,
  };
}

function getMockProviders(): ProviderConfig[] {
  return [
    {
      id: "datago",
      requiresCredential: true,
      summaryConfigured: false,
      lastTest: null,
    },
    {
      id: "kosis",
      requiresCredential: true,
      summaryConfigured: true,
      lastTest: {
        status: "connected",
        checked_at: "2026-09-01T09:30:00+09:00",
        error_category: null,
        response_code: null,
        dataset: null,
      },
    },
    {
      id: "g2b",
      requiresCredential: true,
      summaryConfigured: false,
      lastTest: null,
    },
  ];
}
