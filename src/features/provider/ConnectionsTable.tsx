/**
 * Provider connections as one table (#538): Provider, Authentication, Configured,
 * Last test and an action, one row per provider from GET /providers.
 *
 * - Configured is credential readiness from the summary (`describeCredentialReadiness`):
 *   ready is plain text, a missing key is a badge (#524). Whether *this user* saved a key
 *   is only known for the selected provider, so the list never claims it.
 * - Last test is this principal's `last_test` from GET /providers (kpubdata-builder#842):
 *   null means never tested, an absent field (a Builder before #842) reads `—`.
 *   `not_testable` and `not_configured` say nothing about the key, so they are quiet
 *   text, never a failure badge; only `failed` is a badge.
 * - Test calls `POST /providers/{provider}/test`, which since kpubdata-builder#842 calls a
 *   dataset whose required parameters are all declared and needs no application — so its
 *   result is a provider connection result. Preview still decides a chosen dataset.
 * - No key text is ever rendered here — not even the masked one.
 */
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import type { ProviderLastTest } from "@/shared/lib/builderApi";
import { providerLabel } from "@/shared/lib/providerLabels";
import { describeCredentialReadiness, describeProviderProbe } from "@/shared/lib/providerStatus";
import { Button, cn } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus } from "@/shared/ui/StatusState";

export interface ConnectionRow {
  id: string;
  requiresCredential: boolean;
  summaryConfigured: boolean;
  /** `last_test` from GET /providers; `undefined` when the Builder does not send it. */
  lastTest?: ProviderLastTest | null;
}

function Th({ children, className }: { children: string; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted-foreground", className)} scope="col">
      {children}
    </th>
  );
}

function Configured({ row }: { row: ConnectionRow }) {
  const readiness = describeCredentialReadiness({
    requiresCredential: row.requiresCredential,
    summaryConfigured: row.summaryConfigured,
  });
  if (readiness.tone === "warning") {
    return (
      <ActionableStatus className="whitespace-nowrap" tone="warning">
        {readiness.label}
      </ActionableStatus>
    );
  }
  return <NormalStatus className={readiness.tone === "neutral" ? "text-muted-foreground" : undefined}>{readiness.label}</NormalStatus>;
}

function LastTest({ row }: { row: ConnectionRow }) {
  const { t } = useTranslation();
  if (row.lastTest === undefined) return <MissingStatus label={t("provider.table.lastTestMissing")} />;
  if (row.lastTest === null) {
    return <NormalStatus className="text-muted-foreground">{t("provider.table.neverTested")}</NormalStatus>;
  }
  const test = row.lastTest;
  const presentation = describeProviderProbe({
    status: test.status,
    errorCategory: test.error_category ?? undefined,
    responseCode: test.response_code ?? undefined,
    credentialConfigured: row.summaryConfigured,
  });
  const hint = [presentation.title, presentation.detail].filter(Boolean).join(" — ") || undefined;
  const label =
    presentation.tone === "error" || presentation.tone === "warning" ? (
      <ActionableStatus className="whitespace-nowrap" tone={presentation.tone === "error" ? "failure" : "warning"}>
        {presentation.label}
      </ActionableStatus>
    ) : (
      <NormalStatus className={presentation.tone === "neutral" ? "text-muted-foreground" : undefined}>
        {presentation.label}
      </NormalStatus>
    );
  return (
    <div data-last-test={test.status} title={hint}>
      {label}
      <p className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
        {formatDateTime(test.checked_at)}
        {test.dataset ? <span className="font-mono"> · {test.dataset}</span> : null}
      </p>
      {hint && presentation.tone !== "success" ? <p className="sr-only">{hint}</p> : null}
    </div>
  );
}

export function ConnectionsTable({
  rows,
  selectedId,
  onSelect,
  onTest,
  testingId,
}: {
  rows: ConnectionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Runs `POST /providers/{provider}/test` for one provider. */
  onTest: (id: string) => void;
  /** The provider whose test is in flight, if any. */
  testingId: string | null;
}) {
  const { t } = useTranslation();
  const caption = t("provider.table.caption");
  return (
    // Wider than a phone: the table scrolls inside this region, never the page.
    <div
      aria-label={caption}
      className="relative max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <Th>{t("provider.table.provider")}</Th>
            <Th>{t("provider.table.auth")}</Th>
            <Th>{t("provider.table.configured")}</Th>
            <Th>{t("provider.table.lastTest")}</Th>
            <Th className="text-right">{t("provider.table.action")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = providerLabel(row.id);
            const selected = row.id === selectedId;
            return (
              <tr
                className={cn("cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40", selected && "bg-muted/60")}
                key={row.id}
                // Pointer convenience only; the row's button is the keyboard path.
                onClick={() => onSelect(row.id)}
              >
                <td className="px-3 py-2">
                  {label !== row.id ? <p className="text-foreground">{label}</p> : null}
                  <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
                </td>
                <td className="px-3 py-2 text-foreground">
                  {row.requiresCredential ? t("provider.table.authKey") : t("provider.table.authNone")}
                </td>
                <td className="px-3 py-2">
                  <Configured row={row} />
                </td>
                <td className="px-3 py-2">
                  <LastTest row={row} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button
                    aria-label={`${t("provider.table.test")} — ${row.id}`}
                    className="mr-2"
                    disabled={testingId !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      onTest(row.id);
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    {testingId === row.id ? t("provider.table.testing") : t("provider.table.test")}
                  </Button>
                  <Button
                    aria-label={`${t("provider.table.manage")} — ${row.id}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(row.id);
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    {t("provider.table.manage")}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
