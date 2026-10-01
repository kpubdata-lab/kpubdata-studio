import { i18n } from "@/shared/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getBuild } from "@/features/runs/api/getBuild";
import {
  describePublishFailure,
  getPublishReadiness,
  isSafePublishReference,
  publishCredentialFor,
  validatePublishDestination,
  validatePublishToken,
  type PublishIssue,
  type PublishReadinessResponse,
  type PublishRedistributionRecord,
  type PublishRequest,
  type RedistributionVerdict,
} from "@/features/publish/api";
import { describePublishIssue, redistributionLabel, type PublishIssueLink } from "@/features/publish/issues";
import { DataCardPreview } from "@/features/publish/DataCardPreview";
import { usePublishJob } from "@/features/publish/usePublishJob";
import { ensureVersionChecked, useVersionCheckStore } from "@/features/version-check/store";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type { PublishCredentialSource } from "@/shared/lib/builderApi.schema";
import { formatDateTime } from "@/features/datasets/model";
import type { BuildRunStatus } from "@/shared/lib/types";
import { Button, Card, PageHeader, Skeleton, StatusBadge } from "@/shared/ui";

type ReadinessState =
  | { status: "loading" }
  // `withToken`: whether this answer was computed with an `X-Publish-Credential` sent.
  | { status: "loaded"; data: PublishReadinessResponse; withToken: boolean }
  | { status: "error"; message: string };

/**
 * The publish screen's Run context (Dataset identity + Build completion
 * state) is resolved only from the **exact run_id**, never from the presence
 * of `?dataset=` in the URL — so it renders identically whether entered via
 * Builds/Runs, Artifacts, Dataset Detail or a deep link. The canonical path
 * is `getBuild(runId)` (= `/builds/{run_id}/spec` snapshot + authoritative
 * status); it never substitutes the latest run.
 */
interface RunContext {
  datasetTitle: string;
  datasetId: string;
  status: BuildRunStatus;
  finishedAt: string | null;
}

type RunContextState =
  | { status: "loading" }
  | { status: "loaded"; data: RunContext }
  | { status: "error"; message: string };

/** Keys only, not labels — sentences in module constants would freeze the language (#350). */
const BUILD_STATUS_KEY: Record<BuildRunStatus, string> = {
  queued: "buildPublish.statusQueued",
  running: "buildPublish.statusRunning",
  cancelling: "buildPublish.statusCancelling",
  succeeded: "buildPublish.statusSucceeded",
  failed: "buildPublish.statusFailed",
  cancelled: "buildPublish.statusCancelled",
};

const inputClassName =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Blocker codes related to the credential used for publishing.
 *
 * ``credential_unavailable`` means "no credential anywhere";
 * ``credential_required`` means "this deployment does not lend the server's"
 * (kpubdata-builder #665). Both need the same guidance, but the latter has
 * more direct user actions. */
const CREDENTIAL_BLOCKER_CODES = new Set(["credential_unavailable", "credential_required"]);

/**
 * Whether a token typed here may be sent in `X-Publish-Credential` (#637). Builder reads
 * the header only when it takes credentials from the request; a single-user deployment
 * (`stored`, `stored_or_server`) ignores it, so Studio never sends it there. `null` — an
 * older Builder that does not say — keeps the #615 behaviour of following the blocker.
 */
function acceptsRequestCredential(source: PublishCredentialSource | null): boolean {
  return source !== "stored" && source !== "stored_or_server";
}

/**
 * The one readiness blocker this page itself can clear (#639). Readiness is computed for
 * the target's default options, which never confirm non-commercial use, so a
 * `non_commercial` build always reports `non_commercial_unconfirmed`; the confirmation
 * checkbox answers it, and Builder checks the request's options again on POST.
 */
const CONFIRMABLE_BLOCKER = "non_commercial_unconfirmed";

/** Where a blocker's next step points, for this run. */
function issueLinkPath(link: PublishIssueLink, runId: string): string {
  const base = `/refresh-jobs/${encodeURIComponent(runId)}`;
  if (link === "editSpec") return `${base}/edit`;
  if (link === "openArtifacts") return `${base}/artifacts`;
  return base;
}

/** Wait for Builder's `/version` once per page load; nothing to wait for in demo mode. */
function credentialSourceKnown(): Promise<void> {
  return isRealBuilderEnabled() ? ensureVersionChecked() : Promise.resolve();
}

export function BuildPublishPage() {
  const { t } = useTranslation();
  const { buildId: runId = "" } = useParams();
  const [searchParams] = useSearchParams();
  // `?dataset=` is only a supplementary display hint when present — its
  // absence never marks an actually-existing Run as "unverified" (canonical
  // resolution is runId-based).
  const datasetHint = searchParams.get("dataset") ?? "";
  const [runContext, setRunContext] = useState<RunContextState>({ status: "loading" });
  const [readiness, setReadiness] = useState<ReadinessState>({ status: "loading" });
  const [readinessVersion, setReadinessVersion] = useState(0);
  const [destination, setDestination] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  // The publisher's non-commercial confirmation (#639): offered only for a
  // `non_commercial` verdict and sent as `options.confirm_non_commercial`.
  const [confirmNonCommercial, setConfirmNonCommercial] = useState(false);
  const [confirmation, setConfirmation] = useState<PublishRequest>();
  // The requester's own publish token (#615): React state only — never localStorage,
  // sessionStorage, the URL or a log — gone when the page unmounts or reloads. The ref
  // lets a readiness check read it without re-running on every keystroke.
  const [publishToken, setPublishToken] = useState("");
  const publishTokenRef = useRef("");
  // The token changed since readiness was last checked, so that answer may not hold.
  const [tokenStale, setTokenStale] = useState(false);
  const publish = usePublishJob();
  // Where Builder takes the publish credential from (`GET /version`, contract 1.69.0).
  const credentialSource = useVersionCheckStore((state) => state.publishCredential);
  const requestCredential = acceptsRequestCredential(credentialSource);

  // A confirmation belongs to one run's terms; another run asks again.
  useEffect(() => setConfirmNonCommercial(false), [runId]);

  useEffect(() => {
    if (!runId) {
      setRunContext({ status: "error", message: i18n.t("buildPublish.noRunId") });
      return;
    }
    let active = true;
    setRunContext({ status: "loading" });
    // canonical: getBuild(runId) = BuildSpec snapshot(dataset identity) + authoritative status.
    // Needs neither the dataset URL parameter nor the listDatasetRuns window.
    getBuild(runId)
      .then((run) => {
        if (!active) return;
        setRunContext({
          status: "loaded",
          data: {
            datasetTitle: run.spec.title || run.spec.datasetId || runId,
            datasetId: run.spec.datasetId,
            status: run.status,
            finishedAt: run.finishedAt ?? null,
          },
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setRunContext({
          status: "error",
          message: cause instanceof Error ? cause.message : i18n.t("buildPublish.runInfoError"),
        });
      });
    return () => {
      active = false;
    };
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setReadiness({ status: "error", message: i18n.t("buildPublish.noRunId") });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setReadiness({ status: "loading" });
    setConfirmation(undefined);
    publish.reset();
    // Readiness waits for the credential source, so a token is never sent to a Builder
    // that only takes a stored credential (#637).
    let credential: ReturnType<typeof publishCredentialFor>;
    credentialSourceKnown()
      .then(() => {
        if (!active) return null;
        credential = acceptsRequestCredential(useVersionCheckStore.getState().publishCredential)
          ? publishCredentialFor(publishTokenRef.current)
          : undefined;
        return getPublishReadiness(runId, "huggingface", controller.signal, credential);
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.run_id !== runId || data.target !== "huggingface") {
          setReadiness({ status: "error", message: i18n.t("buildPublish.readinessMismatch") });
          return;
        }
        setReadiness({ status: "loaded", data, withToken: credential !== undefined });
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setReadiness({ status: "error", message: describePublishFailure(cause).message });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [runId, readinessVersion, publish.reset]);

  const runCtx = runContext.status === "loaded" ? runContext.data : null;
  const datasetLabel = runCtx?.datasetTitle ?? (datasetHint || null);
  const buildCompletionText =
    runContext.status === "loading"
      ? t("buildPublish.checking")
      : runCtx
        ? runCtx.status === "succeeded"
          ? runCtx.finishedAt
            ? t("buildPublish.completedAt", { time: formatDateTime(runCtx.finishedAt) })
            : t("buildPublish.completed")
          : `${t(BUILD_STATUS_KEY[runCtx.status])}${runCtx.finishedAt ? ` · ${formatDateTime(runCtx.finishedAt)}` : ""}`
        : t("buildPublish.unconfirmed");

  const destinationError = validatePublishDestination(destination);
  const tokenError = validatePublishToken(publishToken);
  const redistribution = readiness.status === "loaded" ? readiness.data.redistribution ?? null : null;
  const nonCommercial = redistribution?.verdict === "non_commercial";
  const nonCommercialConfirmed = nonCommercial && confirmNonCommercial;
  // Blockers still standing once the page's own confirmation is taken into account.
  const blockers = readiness.status === "loaded"
    ? readiness.data.blockers.filter((issue) => !(nonCommercialConfirmed && issue.code === CONFIRMABLE_BLOCKER))
    : [];
  // Unknown terms allow only a private publish; Builder refuses a public one
  // (`redistribution_unknown`), so the page does not offer it.
  const publicRefused = redistribution?.verdict === "unknown" && !isPrivate;
  const builderReady =
    readiness.status === "loaded" &&
    blockers.length === 0 &&
    // ready:false with no blocker at all stays not ready (UI audit #4); ready:false whose
    // only blocker the confirmation cleared is ready.
    (readiness.data.ready || readiness.data.blockers.length > 0);
  const canReview = Boolean(runId && builderReady && !publicRefused && !destinationError && !tokenError && !tokenStale && publish.status !== "publishing");
  const credentialRequired =
    readiness.status === "loaded" && readiness.data.blockers.some((issue) => issue.code === "credential_required");
  // Builder 1.69.0 says where it takes the credential from (#637): `request` asks for a
  // token up front, `stored`/`stored_or_server` never do. An older Builder does not say,
  // so the field appears on a `credential_required` blocker — a multi-user Builder answers
  // that until a token is sent — and stays while a token is held or was just forgotten.
  const showTokenField =
    credentialSource === "request" ||
    (credentialSource === null && (credentialRequired || publishToken !== "" || tokenStale));
  const credentialRequiredNoteKey = !requestCredential
    ? "buildPublish.storedCredentialRequiredNote"
    : readiness.status !== "loaded" || !readiness.withToken
      ? "buildPublish.credentialRequiredNote"
      : credentialSource === "request"
        ? "buildPublish.requestCredentialStillRequiredNote"
        : "buildPublish.credentialStillRequiredNote";

  const request = useMemo<PublishRequest>(() => ({
    target: "huggingface",
    destination,
    options: nonCommercialConfirmed
      ? { private: isPrivate, confirm_non_commercial: true }
      : { private: isPrivate },
  }), [destination, isPrivate, nonCommercialConfirmed]);

  function updateDestination(value: string) {
    setDestination(value);
    setConfirmation(undefined);
    publish.reset();
  }

  function updatePublishToken(value: string) {
    publishTokenRef.current = value;
    setPublishToken(value);
    setTokenStale(true);
    setConfirmation(undefined);
    publish.reset();
  }

  function recheckReadiness() {
    setTokenStale(false);
    setReadinessVersion((value) => value + 1);
  }

  /**
   * Starts the publish with the token captured here, then drops the token at once: the
   * contract keeps it for the request only, and so does Studio, whatever the outcome
   * (#615). Clearing at start rather than on completion means no outcome — success,
   * failure, abort or an unmount mid-request — can leave it behind. Publishing again
   * means entering the token and checking readiness again (`tokenStale`).
   */
  function startPublish(request: PublishRequest) {
    const credential = requestCredential ? publishCredentialFor(publishTokenRef.current) : undefined;
    publishTokenRef.current = "";
    setPublishToken("");
    if (credential) setTokenStale(true);
    void publish.start(runId, request, credential);
  }

  function updatePrivate(value: boolean) {
    setIsPrivate(value);
    setConfirmation(undefined);
    publish.reset();
  }

  function updateConfirmNonCommercial(value: boolean) {
    setConfirmNonCommercial(value);
    setConfirmation(undefined);
    publish.reset();
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <PageHeader
        title={t("buildPublish.title", { name: datasetLabel || runId || "Run" })}
        description={t("buildPublish.desc")}
      />

      <Card>
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("buildPublish.selectedRun")}</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{t("labels.table")}</dt><dd>{datasetLabel || (runContext.status === "loading" ? t("buildPublish.checking") : t("buildPublish.unconfirmed"))}</dd></div>
          <div><dt className="text-muted-foreground">{t("labels.runId")}</dt><dd className="break-all font-mono">{runId || "—"}</dd></div>
          <div><dt className="text-muted-foreground">{t("buildPublish.buildCompleted")}</dt><dd>{buildCompletionText}</dd></div>
          <div><dt className="text-muted-foreground">{t("labels.target")}</dt><dd>Hugging Face</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{t("buildPublish.exactRunNote")}</p>
        {runContext.status === "error" ? (
          <p className="mt-1 text-xs text-status-warning">{t("buildPublish.datasetLoadWarn")}</p>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">{t("buildPublish.readinessTitle")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("buildPublish.readinessNote")}</p></div>
          <Button variant="secondary" size="sm" disabled={readiness.status === "loading" || publish.status === "publishing" || Boolean(tokenError)} onClick={recheckReadiness}>{t("buildPublish.recheck")}</Button>
        </div>
        {readiness.status === "loading" ? <Skeleton className="mt-4 h-20 w-full" /> : null}
        {readiness.status === "error" ? <div className="mt-4" role="alert"><p className="text-sm text-status-failure">{readiness.message}</p></div> : null}
        {readiness.status === "loaded" ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm font-medium">
              {builderReady
                ? t("buildPublish.readyLabel")
                : blockers.length > 0
                  ? t("buildPublish.blockedLabel")
                  // ready:false with empty blockers ("empty card") must not
                  // be mis-asserted as "has a blocker" — Builder not
                  // supplying a reason is a different state from a real
                  // blocker existing (UI audit #4).
                  : t("buildPublish.notReadyNoReason")}
            </p>
            {redistribution ? <RedistributionSummary verdict={redistribution} /> : null}
            {blockers.length > 0 ? <IssueList title={t("buildPublish.blockers")} issues={blockers} tone="error" runId={runId} /> : null}
            {readiness.data.warnings.length > 0 ? <IssueList title={t("buildPublish.warnings")} issues={readiness.data.warnings} tone="warning" runId={runId} /> : null}
            {nonCommercial ? (
              <label className="flex items-start gap-3 rounded-lg border border-border p-4 text-sm">
                <input aria-label={t("publish.redistribution.confirmLabel")} type="checkbox" checked={confirmNonCommercial} disabled={publish.status === "publishing"} onChange={(event) => updateConfirmNonCommercial(event.target.checked)} className="mt-0.5 h-4 w-4 accent-status-success" />
                <span><strong className="block">{t("publish.redistribution.confirmLabel")}</strong><span className="text-xs text-muted-foreground">{t("publish.redistribution.confirmHint")}</span></span>
              </label>
            ) : null}
            {readiness.data.blockers.some((issue) => CREDENTIAL_BLOCKER_CODES.has(issue.code)) ? <p className="text-xs text-muted-foreground">{t("buildPublish.credentialNote")}</p> : null}
                        {/* credential_required differs from "nowhere"
                (credential_unavailable) — it means more direct user actions
                exist. The two codes carry different guidance; the same
                guidance is never reused. */}
            {credentialRequired ? <p className="text-xs text-muted-foreground">{t(credentialRequiredNoteKey)}</p> : null}
          </div>
        ) : null}
        {showTokenField ? (
          <div className="mt-4 rounded-lg border border-border p-4">
            <label className="text-sm font-medium">{t("buildPublish.tokenLabel")}
              <input
                aria-label={t("buildPublish.tokenLabel")}
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={`mt-2 ${inputClassName}`}
                placeholder="hf_…"
                value={publishToken}
                disabled={publish.status === "publishing"}
                onChange={(event) => updatePublishToken(event.target.value)}
              />
            </label>
            <p className={`mt-1 text-xs ${tokenError ? "text-status-failure" : "text-muted-foreground"}`} role={tokenError ? "alert" : undefined}>{tokenError ?? t("buildPublish.tokenHint")}</p>
            {tokenStale && !tokenError ? <p className="mt-1 text-xs text-status-warning">{t("buildPublish.tokenStale")}</p> : null}
            <div className="mt-3 flex flex-wrap gap-3">
              <Button size="sm" disabled={readiness.status === "loading" || publish.status === "publishing" || Boolean(tokenError) || !publishToken.trim()} onClick={recheckReadiness}>{t("buildPublish.tokenCheck")}</Button>
              {publishToken ? <Button size="sm" variant="ghost" disabled={publish.status === "publishing"} onClick={() => updatePublishToken("")}>{t("buildPublish.tokenForget")}</Button> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <DataCardPreview runId={runId} />

      <Card>
        <h2 className="text-sm font-semibold">{t("buildPublish.settingsTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("buildPublish.settingsNote")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="text-sm font-medium">{t("buildPublish.destinationLabel")}
            <input aria-label={t("buildPublish.destinationLabel")} className={`mt-2 ${inputClassName}`} placeholder="owner/dataset" value={destination} disabled={publish.status === "publishing"} onChange={(event) => updateDestination(event.target.value)} />
            <span className={`mt-1 block text-xs ${destinationError ? "text-status-failure" : "text-muted-foreground"}`}>{destinationError ?? t("buildPublish.destinationHint")}</span>
          </label>
          <label className="flex items-center gap-3 self-center rounded-lg border border-border p-4 text-sm">
            <input aria-label={t("buildPublish.privateLabel")} type="checkbox" checked={isPrivate} disabled={publish.status === "publishing"} onChange={(event) => updatePrivate(event.target.checked)} className="h-4 w-4 accent-status-success" />
            <span><strong className="block">{t("buildPublish.privateLabel")}</strong><span className="text-xs text-muted-foreground">{t("buildPublish.privateDefault")}</span></span>
          </label>
        </div>
        {publicRefused ? <p className="mt-3 text-xs text-status-failure" role="alert">{t("publish.redistribution.unknownPublicNote")}</p> : null}
        {nonCommercial && !isPrivate ? <p className="mt-3 text-xs text-status-warning">{t("publish.redistribution.nonCommercialPublicNote")}</p> : null}
      </Card>

      {!confirmation ? (
        <Button className="self-start" disabled={!canReview} onClick={() => setConfirmation(request)}>{t("buildPublish.review")}</Button>
      ) : (
        <Card className="border-status-success-border" aria-label={t("buildPublish.confirmTitle")}>
          <h2 className="text-sm font-semibold">{t("buildPublish.confirmTitle")}</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("labels.runId")}</dt><dd className="font-mono">{runId}</dd></div>
            <div><dt className="text-muted-foreground">{t("labels.target")}</dt><dd>huggingface</dd></div>
            <div><dt className="text-muted-foreground">{t("labels.destination")}</dt><dd>{confirmation.destination}</dd></div>
            <div><dt className="text-muted-foreground">{t("buildPublish.visibility")}</dt><dd>{confirmation.options?.private === false ? t("labels.public") : t("labels.private")}</dd></div>
            {nonCommercial ? <div><dt className="text-muted-foreground">{t("publish.redistribution.title")}</dt><dd>{confirmation.options?.confirm_non_commercial ? t("publish.redistribution.confirmed") : t("publish.redistribution.notConfirmed")}</dd></div> : null}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">{t("buildPublish.confirmNote")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button loading={publish.status === "publishing"} disabled={!builderReady || publicRefused || tokenStale || Boolean(tokenError) || Boolean(validatePublishDestination(confirmation.destination))} onClick={() => startPublish(confirmation)}>{t("buildPublish.publishNow")}</Button>
            {publish.status !== "publishing" ? <Button variant="secondary" onClick={() => setConfirmation(undefined)}>{t("buildPublish.editSettings")}</Button> : <Button variant="secondary" onClick={publish.stopWaiting}>{t("buildPublish.stopWaiting")}</Button>}
          </div>
        </Card>
      )}

      {publish.status === "published" && publish.result ? (
        <Card variant="success" role="status">
          <div className="flex items-center gap-2"><StatusBadge status="published" /><strong>{t("buildPublish.publishedTitle")}</strong></div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("labels.runId")}</dt><dd className="font-mono">{publish.result.run_id}</dd></div>
            <div><dt className="text-muted-foreground">{t("labels.destination")}</dt><dd>{publish.result.destination}</dd></div>
            <div><dt className="text-muted-foreground">{t("buildPublish.publisher")}</dt><dd>{publish.result.publisher}</dd></div>
            <div><dt className="text-muted-foreground">{t("buildPublish.snapshotFiles")}</dt><dd>{publish.result.artifact_count}</dd></div>
          </dl>
          <div className="mt-4 break-all text-sm">{t("buildPublish.reference")} {isSafePublishReference(publish.result.reference) ? <a href={publish.result.reference} target="_blank" rel="noreferrer" className="text-status-success underline">{publish.result.reference}</a> : <span>{publish.result.reference}</span>}</div>
          {publish.result.redistribution ? <PublishedTerms record={publish.result.redistribution} /> : null}
        </Card>
      ) : null}
      {publish.status === "failed" ? (
        <Card variant="error" role="alert">
          <strong>{t("buildPublish.publishFailed")}</strong>
          <p className="mt-2 text-sm">{publish.failure?.message}</p>
          {publish.failure?.kind === "publish_state_unknown" ? <p className="mt-2 text-xs">{t("buildPublish.noAutoRetry")}</p> : null}
          {publish.failure?.kind === "redistribution_blocked" && publish.failure.redistribution ? <div className="mt-4"><RedistributionSummary verdict={publish.failure.redistribution} /></div> : null}
          {publish.failure?.blockers?.length ? <div className="mt-4"><IssueList title={t("buildPublish.blockers")} issues={publish.failure.blockers} tone="error" runId={runId} /></div> : null}
        </Card>
      ) : null}
      {publish.status === "aborted" ? <Card role="status"><strong>{t("buildPublish.abortedTitle")}</strong><p className="mt-2 text-sm text-muted-foreground">{t("buildPublish.abortedBody")}</p></Card> : null}
    </div>
  );
}

/**
 * Blockers or warnings, each with Studio's own sentence and next step for its code
 * (#644). Builder's message stays visible underneath as the specific detail; a code
 * Studio does not know is a generic blocker that names the code.
 */
function IssueList({ title, issues, tone, runId }: { title: string; issues: PublishIssue[]; tone: "error" | "warning"; runId: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="mt-2 space-y-2">
        {issues.map((issue, index) => {
          const described = describePublishIssue(issue);
          return (
            <li key={`${issue.code}-${index}`} data-issue-code={issue.code} className={`rounded-lg px-3 py-2 text-sm ${tone === "error" ? "bg-status-failure-subtle text-status-failure" : "bg-status-warning-subtle text-status-warning"}`}>
              <p className="font-medium">{described.message}</p>
              <p className="mt-1 text-xs">
                {described.action}
                {described.link ? <> <Link to={issueLinkPath(described.link, runId)} className="underline">{t(`publish.issueLinks.${described.link}`)}</Link></> : null}
              </p>
              <p className="mt-1 text-xs opacity-80"><span className="font-mono">{issue.code}</span><span className="ml-2">{issue.message}</span></p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The sources' redistribution verdict (#639): the build's, then each source's reason. */
function RedistributionSummary({ verdict }: { verdict: RedistributionVerdict }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("publish.redistribution.title")} className="rounded-lg border border-border p-4 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("publish.redistribution.title")}</h3>
      <p className="mt-2 font-medium">{t("publish.redistribution.verdict", { verdict: redistributionLabel(verdict.verdict) })}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t(`publish.redistribution.explain.${verdict.verdict}`)}</p>
      {verdict.sources.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {verdict.sources.map((source) => (
            <li key={source.source}>{t("publish.redistribution.source", { source: source.source, verdict: redistributionLabel(source.verdict), reason: source.reason })}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The terms a successful publish went out under, as Builder recorded them (#651). */
function PublishedTerms({ record }: { record: PublishRedistributionRecord }) {
  const { t } = useTranslation();
  return (
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t("publish.redistribution.publishedUnder")}</dt><dd>{redistributionLabel(record.verdict)}{record.verdict === "non_commercial" ? ` · ${record.confirm_non_commercial ? t("publish.redistribution.confirmed") : t("publish.redistribution.notConfirmed")}` : ""}</dd></div>
      <div><dt className="text-muted-foreground">{t("publish.redistribution.kpubdataVersion")}</dt><dd className="font-mono">{record.kpubdata_version ?? t("publish.redistribution.versionUnknown")}</dd></div>
    </dl>
  );
}
