/**
 * The column profile of the snapshot on screen (`GET /warehouse/tables/{name}/profile`,
 * builder#817, #896, #897).
 *
 * The request names the concrete snapshot id, never `current`, and a profile Builder sends
 * for any other snapshot is refused — the same pinning `useWarehouseRows` keeps, so a commit
 * in the meantime never puts another snapshot's statistics under this one's id.
 *
 * Every figure is the contract field as sent: null, NaN and infinite counts, the null
 * ratio, and the range with its status. A column Builder withheld as suspected personal
 * data shows its name, types and sensitivity only — Builder sends no statistic for it, and
 * the screen says why instead of leaving blanks. A range over too few values is withheld
 * by Builder and said so ("too few values"), never shown as empty. A `trimmed` range
 * (builder#903) is the min/max after Builder left out the extremes, and says so — it is
 * never presented as the column's exact minimum and maximum.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import { warehouseApi } from "@/features/sql/warehouseApi";
import type { ColumnProfile, SnapshotProfileResponse } from "@/shared/lib/builderApi";
import { Button, Card, ErrorState, LinkButton, Skeleton } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus, NotEvaluatedStatus } from "@/shared/ui/StatusState";

import { PROFILE_TIMEOUT_MEMORY_MS, profileRefusal, type ProfileRefusal } from "../profileRefusal";

type ProfileState =
  | { status: "loading" }
  | { status: "loaded"; data: SnapshotProfileResponse }
  | { status: "refused"; refusal: ProfileRefusal; at: number }
  | { status: "error"; message: string };

/** Thrown when Builder answers for a snapshot other than the one asked for. */
class SnapshotMismatchError extends Error {}

function count(value: number): string {
  return value.toLocaleString("ko-KR");
}

/** A ratio as a percentage; the exact contract value stays in the tooltip. */
function ratio(value: number): string {
  if (value === 0) return "0%";
  const percent = value * 100;
  if (percent < 0.01) return "<0.01%";
  return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

/** A range endpoint as sent: text (decimal strings, temporal values) verbatim, numbers as numbers. */
function endpoint(value: unknown): ReactNode {
  if (value === undefined || value === null) return <MissingStatus />;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function CountCell({ value }: { value: number | null }) {
  // Null here means the count does not apply (NaN and infinity exist only in float columns).
  return value === null ? <NotEvaluatedStatus /> : <span className="tabular-nums">{count(value)}</span>;
}

function NullCell({ column }: { column: ColumnProfile }) {
  if (column.null_count === null) return <NotEvaluatedStatus />;
  return (
    <span className="tabular-nums">
      {count(column.null_count)}
      <span className="ml-1 text-xs text-muted-foreground" title={column.null_ratio === null ? undefined : String(column.null_ratio)}>
        ({column.null_ratio === null ? <NotEvaluatedStatus /> : ratio(column.null_ratio)})
      </span>
    </span>
  );
}

function RangeCell({ column, minValues, rangeTrim }: { column: ColumnProfile; minValues: number; rangeTrim: number | undefined }) {
  const { t } = useTranslation();
  const range = column.range;
  if (range === null) return <MissingStatus />;
  if (range.status === "not_applicable") return <NotEvaluatedStatus />;
  if (range.status === "no_values") return <NotEvaluatedStatus>{t("profile.range.noValues")}</NotEvaluatedStatus>;
  if (range.status === "withheld_small_group") {
    return (
      <NotEvaluatedStatus>
        {t("profile.range.smallGroup")}
        <span className="block text-xs">
          {range.value_count === undefined ? t("profile.range.smallGroupRule", { min: minValues }) : t("profile.range.smallGroupCount", { count: range.value_count, min: minValues })}
        </span>
      </NotEvaluatedStatus>
    );
  }
  return (
    <span>
      <span className="font-mono text-xs">
        {endpoint(range.min)} … {endpoint(range.max)}
      </span>
      {range.status === "trimmed" ? (
        <span className="block text-xs text-muted-foreground" data-range-status="trimmed">
          {rangeTrim === undefined ? t("profile.range.trimmedUnknown") : t("profile.range.trimmed", { count: rangeTrim })}
        </span>
      ) : null}
      {range.excluded_count ? <span className="block text-xs text-muted-foreground">{t("profile.range.excluded", { count: range.excluded_count })}</span> : null}
    </span>
  );
}

function SensitivityCell({ column }: { column: ColumnProfile }) {
  const { t } = useTranslation();
  const { status, kinds } = column.sensitivity;
  const kindList =
    kinds.length > 0 ? (
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {kinds.map((kind) => (kind === "unchecked_values" ? t("profile.sensitivity.uncheckedValues") : kind)).join(", ")}
      </span>
    ) : null;
  if (status === "suspected") {
    return (
      <span data-sensitivity="suspected">
        <ActionableStatus tone="warning">{t("profile.sensitivity.suspected")}</ActionableStatus>
        {kindList}
      </span>
    );
  }
  return (
    <span data-sensitivity={status}>
      <NormalStatus>{t(status === "allowed_by_spec" ? "profile.sensitivity.allowedBySpec" : "profile.sensitivity.notDetected")}</NormalStatus>
      {kindList}
    </span>
  );
}

function ProfileRow({ column, minValues, rangeTrim }: { column: ColumnProfile; minValues: number; rangeTrim: number | undefined }) {
  const { t } = useTranslation();
  const withheld = column.status === "withheld";
  return (
    <tr className="border-b border-border align-top last:border-0" data-column-status={column.status}>
      <th className="px-4 py-2 font-mono font-normal" scope="row">
        {column.name}
      </th>
      <td className="px-4 py-2">
        <span className="font-mono text-xs">{column.logical_type}</span>
        <span className="block font-mono text-[11px] text-muted-foreground">{t("profile.storage", { type: column.storage_type })}</span>
        {column.time_zone ? <span className="block font-mono text-[11px] text-muted-foreground">{column.time_zone}</span> : null}
      </td>
      <td className="px-4 py-2">
        <SensitivityCell column={column} />
      </td>
      {withheld ? (
        <td className="px-4 py-2" colSpan={4}>
          <NotEvaluatedStatus>{t("profile.withheld")}</NotEvaluatedStatus>
        </td>
      ) : (
        <>
          <td className="px-4 py-2 text-right">
            <NullCell column={column} />
          </td>
          <td className="px-4 py-2 text-right">
            <CountCell value={column.nan_count} />
          </td>
          <td className="px-4 py-2 text-right">
            <CountCell value={column.infinite_count} />
          </td>
          <td className="px-4 py-2">
            <RangeCell column={column} minValues={minValues} rangeTrim={rangeTrim} />
          </td>
        </>
      )}
    </tr>
  );
}

function Refused({
  refusal,
  at,
  now,
  queryHref,
  onRetry,
  onOpenTab,
}: {
  refusal: ProfileRefusal;
  at: number;
  now: number;
  queryHref: string;
  onRetry: () => void;
  onOpenTab: (tab: "overview" | "snapshots") => void;
}) {
  const { t } = useTranslation();
  const retryAt = at + PROFILE_TIMEOUT_MEMORY_MS;
  const waiting = refusal.code === "query_timeout" && now < retryAt;
  const time = new Date(retryAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return (
    <Card className="space-y-2" data-refusal={refusal.code} role="alert" variant="error">
      <p className="font-semibold">{t(`profile.refused.${refusal.code}.title`)}</p>
      <p className="text-sm">{t(`profile.refused.${refusal.code}.body`)}</p>
      {refusal.code === "query_timeout" ? <p className="text-sm">{t("profile.refused.query_timeout.next", { time })}</p> : null}
      {refusal.code === "redistribution_forbidden" && refusal.sources.length > 0 ? (
        <p className="font-mono text-xs">{t("profile.refused.redistribution_forbidden.sources", { sources: refusal.sources.join(", ") })}</p>
      ) : null}
      {refusal.code === "pii_declaration_unavailable" && refusal.dataset ? (
        <p className="font-mono text-xs">{t("profile.refused.pii_declaration_unavailable.dataset", { dataset: refusal.dataset })}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {refusal.code === "query_timeout" || refusal.code === "query_busy" || refusal.code === "pii_declaration_unavailable" ? (
          <Button disabled={waiting} onClick={onRetry} size="sm" variant="secondary">
            {waiting ? t("profile.retryAfter", { time }) : t("profile.retry")}
          </Button>
        ) : null}
        {refusal.code === "query_timeout" ? (
          <LinkButton size="sm" to={queryHref} variant="secondary">
            {t("profile.refused.query_timeout.query")}
          </LinkButton>
        ) : null}
        {refusal.code === "snapshot_unavailable" ? (
          <Button onClick={() => onOpenTab("snapshots")} size="sm" variant="secondary">
            {t("profile.refused.snapshot_unavailable.action")}
          </Button>
        ) : null}
        {refusal.code === "redistribution_forbidden" ? (
          <Button onClick={() => onOpenTab("overview")} size="sm" variant="secondary">
            {t("profile.refused.redistribution_forbidden.action")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function ProfileTab({
  table,
  snapshot,
  queryHref,
  onOpenTab,
}: {
  table: string;
  snapshot: string;
  queryHref: string;
  onOpenTab: (tab: "overview" | "snapshots") => void;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    warehouseApi()
      .getWarehouseTableProfile(table, snapshot, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.snapshot.snapshot_id !== snapshot || data.profile.snapshot_id !== snapshot) {
          throw new SnapshotMismatchError(t("profile.mismatch", { requested: snapshot, received: data.profile.snapshot_id }));
        }
        setState({ status: "loaded", data });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const refusal = profileRefusal(cause);
        if (refusal) {
          const at = Date.now();
          setNow(at);
          return setState({ status: "refused", refusal, at });
        }
        setState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => controller.abort();
    // `t` only words the mismatch; the request depends on the table, snapshot and attempt.
  }, [table, snapshot, attempt]);

  // After a timeout, re-enable the retry once Builder stops remembering it.
  const refusedAt = state.status === "refused" && state.refusal.code === "query_timeout" ? state.at : null;
  useEffect(() => {
    if (refusedAt === null) return;
    const over = refusedAt + PROFILE_TIMEOUT_MEMORY_MS;
    // When the timer fires the remembered timeout is over, whatever the clock reads.
    const release = () => setNow((value) => Math.max(value, Date.now(), over));
    const timer = setTimeout(release, Math.max(0, over - Date.now()));
    return () => clearTimeout(timer);
  }, [refusedAt]);

  const retry = () => setAttempt((value) => value + 1);

  if (state.status === "loading") {
    return (
      <Card>
        <p className="text-xs text-muted-foreground">{t("profile.loading")}</p>
        <Skeleton className="mt-3 h-40 w-full" />
      </Card>
    );
  }
  if (state.status === "refused") {
    return <Refused at={state.at} now={now} onOpenTab={onOpenTab} onRetry={retry} queryHref={queryHref} refusal={state.refusal} />;
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retry} retryLabel={t("profile.retry")} title={t("profile.error")} />;
  }

  const { profile } = state.data;
  const withheld = profile.columns.filter((column) => column.status === "withheld").length;
  return (
    <Card className="overflow-hidden p-0">
      <div className="space-y-1 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{t("profile.title")}</h2>
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="inline text-muted-foreground">{t("tableDetail.labels.snapshot")} </dt>
            <dd className="inline font-mono">{profile.snapshot_id}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("tableDetail.labels.rows")} </dt>
            <dd className="inline tabular-nums">{count(profile.row_count)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("profile.computedAt")} </dt>
            <dd className="inline">{formatDateTime(profile.computed_at)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("profile.method")} </dt>
            <dd className="inline font-mono">
              {profile.scope.mode} · {profile.accuracy}
              {profile.scope.sampled ? ` · ${t("profile.sampled", { count: profile.scope.sample_size ?? 0 })}` : ""} · v{profile.algorithm_version}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {profile.range_trim
            ? t("profile.noteTrimmed", { min: profile.min_range_values, count: profile.range_trim })
            : t("profile.note", { min: profile.min_range_values })}
        </p>
        {withheld > 0 ? <p className="text-xs text-muted-foreground">{t("profile.withheldNote", { count: withheld })}</p> : null}
      </div>
      {profile.columns.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t("profile.noColumns")}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px] leading-[18px]">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.schema.column")}</th>
                <th className="px-4 py-2 font-medium" scope="col">{t("tableDetail.schema.type")}</th>
                <th className="px-4 py-2 font-medium" scope="col">{t("profile.columns.sensitivity")}</th>
                <th className="px-4 py-2 text-right font-medium" scope="col">{t("profile.columns.nulls")}</th>
                <th className="px-4 py-2 text-right font-medium" scope="col">{t("profile.columns.nan")}</th>
                <th className="px-4 py-2 text-right font-medium" scope="col">{t("profile.columns.infinite")}</th>
                <th className="px-4 py-2 font-medium" scope="col">{t("profile.columns.range")}</th>
              </tr>
            </thead>
            <tbody>
              {profile.columns.map((column) => (
                <ProfileRow column={column} key={column.name} minValues={profile.min_range_values} rangeTrim={profile.range_trim} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
