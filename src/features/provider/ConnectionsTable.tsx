/**
 * Provider connections as one table (#538): Provider, Authentication, Configured,
 * Last test and an action, one row per provider from GET /providers.
 *
 * - Configured is credential readiness from the summary (`describeCredentialReadiness`):
 *   ready is plain text, a missing key is a badge (#524). Whether *this user* saved a key
 *   is only known for the selected provider, so the list never claims it.
 * - Last test is `—`: GET /providers records no test, and the generic probe
 *   (`POST /providers/{provider}/test`) calls an arbitrary first dataset without its
 *   required parameters, so its result is not shown as a connection result
 *   (#S-provider-probe, kpubdata-builder#842).
 * - No key text is ever rendered here — not even the masked one.
 */
import { useTranslation } from "react-i18next";

import { providerLabel } from "@/shared/lib/providerLabels";
import { describeCredentialReadiness } from "@/shared/lib/providerStatus";
import { Button, cn } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus } from "@/shared/ui/StatusState";

export interface ConnectionRow {
  id: string;
  requiresCredential: boolean;
  summaryConfigured: boolean;
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

export function ConnectionsTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ConnectionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
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
                  <MissingStatus label={t("provider.table.lastTestMissing")} />
                </td>
                <td className="px-3 py-2 text-right">
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
