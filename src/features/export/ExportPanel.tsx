/**
 * Download a query's result — only through KPubData Builder's exporter (#501, builder#819).
 *
 * Studio never writes a result file. The request pins the table, the snapshot and the SQL;
 * Builder checks the source's licence and PII policy, runs the query on that snapshot,
 * refuses a result over the row or byte limit instead of cutting it, and keeps the bundle
 * (data file, `manifest.json`, `NOTICE.md`). Studio shows what the manifest says — the
 * concrete snapshot read, the terms verbatim, that the result is user-derived — and then
 * fetches Builder's zip with the person's own credentials.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { saveBlobAsFile } from "@/features/artifacts/api";
import { ApiError, type WarehouseExport } from "@/shared/lib/builderApi";
import { warehouseApi } from "@/features/sql/warehouseApi";
import { Button, Card } from "@/shared/ui";

const field =
  "mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A refusal, in the words the person needs: what blocked it and that nothing was kept. */
export function describeRefusal(cause: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (cause instanceof ApiError) {
    const details = (cause.details ?? {}) as { code?: string; error?: string; findings?: Array<{ column?: string; kind?: string; count?: number }> };
    const code = details.code ?? details.error;
    if (code === "export_forbidden_by_license") return t("export.refused.license");
    if (code === "export_blocked_pii") {
      const findings = (details.findings ?? []).map((finding) => `${finding.column} (${finding.kind}, ${finding.count})`).join(", ");
      return t("export.refused.pii", { findings });
    }
    if (code === "row_limit_exceeded" || code === "byte_limit_exceeded") return t("export.refused.limit");
    return t("export.refused.other", { message: cause.message });
  }
  return t("export.refused.other", { message: cause instanceof Error ? cause.message : String(cause) });
}

export function ExportPanel({ table, snapshot, sql }: { table: string; snapshot: string; sql: string }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<"csv" | "jsonl">("csv");
  const [profile, setProfile] = useState<"machine" | "spreadsheet">("machine");
  const [maxRows, setMaxRows] = useState(100_000);
  const [busy, setBusy] = useState<"export" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<WarehouseExport | null>(null);

  async function create() {
    setBusy("export");
    setError(null);
    setDone(null);
    try {
      setDone(
        await warehouseApi().createWarehouseExport({
          table,
          snapshot,
          sql,
          format,
          profile: format === "csv" ? profile : "machine",
          max_rows: maxRows,
        }),
      );
    } catch (cause) {
      setError(describeRefusal(cause, t));
    } finally {
      setBusy(null);
    }
  }

  async function download(item: WarehouseExport) {
    setBusy("download");
    setError(null);
    try {
      const { blob, filename } = await warehouseApi().downloadWarehouseExport(item.export_id);
      saveBlobAsFile(blob, filename);
    } catch (cause) {
      setError(describeRefusal(cause, t));
    } finally {
      setBusy(null);
    }
  }

  const manifest = done?.manifest;
  const terms = manifest?.source.terms;
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">{t("export.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("export.note")}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-semibold text-muted-foreground">
          {t("export.format")}
          <select className={field} onChange={(event) => setFormat(event.target.value as "csv" | "jsonl")} value={format}>
            <option value="csv">CSV</option>
            <option value="jsonl">JSON Lines</option>
          </select>
        </label>
        {format === "csv" ? (
          <label className="text-xs font-semibold text-muted-foreground">
            {t("export.profile")}
            <select className={field} onChange={(event) => setProfile(event.target.value as "machine" | "spreadsheet")} value={profile}>
              <option value="machine">{t("export.machine")}</option>
              <option value="spreadsheet">{t("export.spreadsheet")}</option>
            </select>
          </label>
        ) : null}
        <label className="text-xs font-semibold text-muted-foreground">
          {t("export.maxRows")}
          <input
            className={field}
            max={1_000_000}
            min={1}
            onChange={(event) => setMaxRows(Math.min(1_000_000, Math.max(1, Math.trunc(event.target.valueAsNumber) || 1)))}
            type="number"
            value={maxRows}
          />
        </label>
      </div>
      {format === "csv" && profile === "spreadsheet" ? <p className="text-xs text-muted-foreground">{t("export.bomNote")}</p> : null}
      <Button disabled={!table || !sql.trim() || busy !== null} loading={busy === "export"} onClick={() => void create()} size="sm" variant="secondary">
        {t("export.create")}
      </Button>
      {error ? (
        <p className="text-sm text-status-failure" role="alert">
          {error}
        </p>
      ) : null}
      {done && manifest && terms ? (
        <div className="space-y-2 rounded-lg border border-border p-3 text-sm" role="status">
          <p className="font-semibold">{t("export.ready", { rows: manifest.output.row_count, file: manifest.output.file.name })}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="font-mono">{t("export.snapshot", { table: manifest.snapshot.logical_name, snapshot: manifest.snapshot.snapshot_id, revision: manifest.snapshot.revision })}</li>
            <li>{manifest.snapshot.coverage === null ? t("export.coverageUnknown") : t("export.coverageKnown")}</li>
            <li>{manifest.query.user_derived ? t("export.derived") : null}</li>
            <li>
              {t("export.terms")}{" "}
              {terms.status === "declared" ? (
                <span className="text-foreground">{[terms.license_name ?? terms.license, terms.attribution].filter(Boolean).join(" · ")}</span>
              ) : (
                <span className="font-semibold text-status-warning">{t("export.termsUnknown", { status: terms.status })}</span>
              )}
            </li>
            {manifest.output.values_altered.length ? (
              <li>
                {t("export.altered", {
                  cells: manifest.output.values_altered.map((item) => `${item.column} ${item.count}`).join(", "),
                })}
              </li>
            ) : null}
            <li>{t("export.expires", { at: done.expires_at })}</li>
          </ul>
          <Button disabled={!done.download_path || busy !== null} loading={busy === "download"} onClick={() => void download(done)} size="sm">
            {t("export.download")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
