/**
 * The data card a publish will carry, shown before publishing (#646).
 *
 * Each Gold output's `card.json` (`DatasetCard`, kpubdata-builder#906/#955) is rendered section by section —
 * provenance, processing, personal information — with Builder's own sentences, because
 * those sentences are what the published README says. Studio adds only labels and three
 * marks the user has to see before publishing:
 *
 * - an empty required section, which blocks publishing (`card_incomplete`), is an
 *   actionable failure, never a blank;
 * - a licence that differs from the one kpubdata declares for the source is an
 *   actionable warning, with the provider's licence next to it;
 * - an explicit "no transformation" is said as such, apart from an empty section.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  cardLicence,
  cardProcessing,
  failureStatus,
  loadDataCards,
  type CardOutput,
  type CardProcessingStep,
  type DataCard,
  type DataCardSource,
} from "@/features/publish/card";
import { isRealBuilderEnabled } from "@/shared/lib/builderApi";
import { Card, EmptyState, Skeleton } from "@/shared/ui";
import { ActionableStatus, NormalStatus, NotEvaluatedStatus } from "@/shared/ui/StatusState";

type PreviewState =
  | { status: "loading" }
  | { status: "demo" }
  | { status: "error"; httpStatus: number | null }
  | { status: "loaded"; outputs: CardOutput[] };

function filled(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A required card field Builder left empty: publishing is blocked until it is filled. */
function EmptySection() {
  const { t } = useTranslation();
  return <ActionableStatus tone="failure">{t("publish.card.empty")}</ActionableStatus>;
}

/**
 * Card preview panel of the publish page.
 *
 * @param props.runId - The exact run being published.
 */
export function DataCardPreview({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    if (!runId) return;
    if (!isRealBuilderEnabled()) {
      setState({ status: "demo" });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    loadDataCards(runId, controller.signal)
      .then((outputs) => {
        if (active) setState({ status: "loaded", outputs });
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState({ status: "error", httpStatus: failureStatus(cause) });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [runId]);

  return (
    <Card aria-label={t("publish.card.title")} data-card-preview={state.status}>
      <h2 className="text-sm font-semibold">{t("publish.card.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("publish.card.note")}</p>
      {state.status === "loading" ? <Skeleton className="mt-4 h-24 w-full" /> : null}
      {state.status === "demo" ? (
        <p className="mt-4 text-sm">
          <NotEvaluatedStatus>{t("publish.card.demo")}</NotEvaluatedStatus>
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="mt-4 text-sm text-status-failure" data-card-error="list">
          {t("publish.card.listError")}
          {state.httpStatus ? ` (${t("publish.card.httpStatus", { status: state.httpStatus })})` : ""}
        </p>
      ) : null}
      {state.status === "loaded" && state.outputs.length === 0 ? (
        <EmptyState className="py-8" title={t("publish.card.none.title")} description={t("publish.card.none.desc")} />
      ) : null}
      {state.status === "loaded" && state.outputs.length > 0 ? (
        <div className="mt-4 space-y-6">
          {state.outputs.map((output) => (
            <CardOutputView key={output.path} output={output} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function CardOutputView({ output }: { output: CardOutput }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("publish.card.outputTitle", { key: output.key })} data-card-output={output.key} className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{t("publish.card.outputTitle", { key: output.key })}</h3>
      {output.status === "loaded" ? (
        <CardSections card={output.card} />
      ) : output.status === "refused" ? (
        <p className="mt-2 text-sm">
          <NormalStatus>{t(`publish.card.refused.${output.refusal.code}`)}</NormalStatus>
        </p>
      ) : (
        <p className="mt-2 text-sm text-status-failure" data-card-error="output">
          {t("publish.card.outputError")}
          {output.httpStatus ? ` (${t("publish.card.httpStatus", { status: output.httpStatus })})` : ""}
        </p>
      )}
    </section>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

function CardSections({ card }: { card: DataCard }) {
  const { t } = useTranslation();
  const provenance = card.provenance;
  const processing = cardProcessing(card);
  return (
    <div>
      {filled(card.title) ? <p className="mt-1 text-sm text-muted-foreground">{card.title}</p> : null}

      <SectionHeading>{t("publish.card.sections.provenance")}</SectionHeading>
      {provenance.length === 0 ? (
        <p className="mt-2 text-sm"><EmptySection /></p>
      ) : (
        <div className="mt-2 space-y-3">
          {provenance.map((source, index) => (
            <SourceProvenance key={`${source.source}-${index}`} source={source} />
          ))}
        </div>
      )}

      <SectionHeading>{t("publish.card.sections.processing")}</SectionHeading>
      {processing.kind === "empty" ? (
        <p className="mt-2 text-sm"><EmptySection /></p>
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm" data-card-section="processing">
          {processing.steps.map((step, index) => (
            <ProcessingStep key={`${index}-${step.text}`} step={step} />
          ))}
        </ol>
      )}

      <SectionHeading>{t("publish.card.sections.personalInformation")}</SectionHeading>
      <p className="mt-2 text-sm" data-card-section="personal_information">
        {filled(card.personal_information) ? card.personal_information : <EmptySection />}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">{t("publish.card.verbatimNote")}</p>
    </div>
  );
}

function SourceProvenance({ source }: { source: DataCardSource }) {
  const { t } = useTranslation();
  const licence = cardLicence(source);
  return (
    <div data-card-source={source.source}>
      <p className="text-sm font-medium">{t("publish.card.sourceHeading", { source: source.source || "—" })}</p>
      <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t("publish.card.fields.attribution")}</dt>
        <dd>{filled(source.institution) ? source.institution : <EmptySection />}</dd>
        <dt className="text-muted-foreground">{t("publish.card.fields.sourceUrl")}</dt>
        <dd className="break-all">
          {filled(source.url) ? (
            /^https?:\/\//i.test(source.url) ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.url}</a>
            ) : (
              source.url
            )
          ) : (
            <EmptySection />
          )}
        </dd>
        <dt className="text-muted-foreground">{t("publish.card.fields.licence")}</dt>
        <dd data-card-field="licence">
          {licence ? (
            <>
              <span>{licence.declared}</span>
              {licence.mismatch ? (
                <span className="mt-1 flex flex-wrap items-center gap-2" data-licence-mismatch="true">
                  <ActionableStatus tone="warning" axis={t("publish.card.licenceMismatchAxis")}>{t("publish.card.licenceMismatch")}</ActionableStatus>
                  {licence.provider ? <span className="text-xs">{t("publish.card.providerDeclares", { licence: licence.provider })}</span> : null}
                </span>
              ) : null}
            </>
          ) : (
            <EmptySection />
          )}
        </dd>
        <dt className="text-muted-foreground">{t("publish.card.fields.collectedAt")}</dt>
        <dd>{filled(source.collected_at) ? source.collected_at : <EmptySection />}</dd>
      </dl>
      {licence?.mismatch ? <p className="mt-1 text-xs text-status-warning">{t("publish.card.licenceMismatchNote")}</p> : null}
    </div>
  );
}

function ProcessingStep({ step: parsed }: { step: CardProcessingStep }) {
  const { t } = useTranslation();
  if (parsed.kind === "none") {
    return (
      <li data-processing="none">
        <NormalStatus className="font-medium">
          {parsed.source ? t("publish.card.noProcessingFor", { source: parsed.source }) : t("publish.card.noProcessing")}
        </NormalStatus>
        <span className="ml-2 text-xs text-muted-foreground">{parsed.text}</span>
      </li>
    );
  }
  if (parsed.kind === "join") {
    return (
      <li data-processing="join">
        <span className="mr-2 rounded-md border border-border px-1.5 py-0.5 text-xs font-medium">{t("publish.card.joinLabel")}</span>
        <span>{parsed.text}</span>
      </li>
    );
  }
  return <li data-processing="step">{parsed.text}</li>;
}
