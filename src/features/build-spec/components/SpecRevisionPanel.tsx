/**
 * Revision history of the spec being edited (#649, kpubdata-builder#820).
 *
 * Reads the latest revision when editing starts and keeps it as the base every save is
 * checked against (`expected_revision`). A save that another person beat is refused by
 * Builder with nothing stored; the panel says so and offers to load what they saved.
 * The history lists every revision with its server-decided author and time, the audit
 * trail, and a revert for each older revision — which Builder records as a new one.
 *
 * Loading a revision (latest or a revert's result) replaces the form through `onLoad`;
 * the spec it hands over has already been through the restore redaction rule, so a
 * marker in it fails closed exactly like a restored run spec.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import {
  createIdempotencyKeys,
  latestSpecRevision,
  revertSpecRevision,
  saveSpecRevision,
  specFromRevision,
  specRevisionHistory,
  type RevisionOutcome,
} from "@/features/build-spec/specRevisions";
import type { DocumentRevision, RevisionHistoryResponse } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";
import { ActionableStatus, NormalStatus } from "@/shared/ui/StatusState";
import { Button, Card, Disclosure, TextInput } from "@/shared/ui";

export interface SpecRevisionPanelProps {
  /** Document id of the table's spec; `null` when the table id cannot be one. */
  docId: string | null;
  /** The spec the form would save now, or `undefined` while the form has an error. */
  spec: BuildSpec | undefined;
  /** Replace the form with a revision's spec. */
  onLoad: (spec: BuildSpec) => void;
}

type BaseState =
  | { status: "loading" }
  | { status: "ready"; revision: number }
  | { status: "error"; message: string };

type HistoryState =
  | { status: "loading" }
  | { status: "loaded"; data: RevisionHistoryResponse }
  | { status: "error"; message: string };

type Notice =
  | Exclude<RevisionOutcome, { status: "saved" }>
  | { status: "saved"; revision: number }
  | { status: "reverted"; revision: number; from: number }
  | { status: "loaded"; revision: number }
  | { status: "unreadable"; revision: number };

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SpecRevisionPanel({ docId, spec, onLoad }: SpecRevisionPanelProps) {
  const { t } = useTranslation();
  const [base, setBase] = useState<BaseState>({ status: "loading" });
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // One key ring per edit session: a retried save keeps its idempotency key.
  const keysRef = useRef(createIdempotencyKeys());

  const loadHistory = useCallback(async (id: string) => {
    setHistory({ status: "loading" });
    try {
      setHistory({ status: "loaded", data: await specRevisionHistory(id) });
    } catch (cause) {
      setHistory({ status: "error", message: messageOf(cause) });
    }
  }, []);

  // The revision the edit is based on is the latest one when editing starts.
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setBase({ status: "loading" });
    latestSpecRevision(docId)
      .then((latest) => {
        if (!cancelled) setBase({ status: "ready", revision: latest?.revision ?? 0 });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setBase({ status: "error", message: messageOf(cause) });
      });
    void loadHistory(docId);
    return () => {
      cancelled = true;
    };
  }, [docId, loadHistory]);

  if (!docId) {
    return (
      <Card>
        <h2 className="text-sm font-semibold">{t("specRevisions.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("specRevisions.noDocId")}</p>
      </Card>
    );
  }
  const id = docId;

  /** Put a revision's spec in the form and make it the base of the next save. */
  function adopt(revision: DocumentRevision): boolean {
    const restored = specFromRevision(revision);
    setBase({ status: "ready", revision: revision.revision });
    if (!restored) return false;
    onLoad(restored);
    return true;
  }

  async function loadLatest() {
    setBusy(true);
    try {
      const latest = await latestSpecRevision(id);
      if (!latest) {
        setBase({ status: "ready", revision: 0 });
        setNotice(null);
      } else {
        setNotice(adopt(latest) ? { status: "loaded", revision: latest.revision } : { status: "unreadable", revision: latest.revision });
      }
      await loadHistory(id);
    } catch (cause) {
      setNotice({ status: "error", message: messageOf(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!spec || base.status !== "ready") return;
    setBusy(true);
    const outcome = await saveSpecRevision({
      docId: id,
      spec,
      expectedRevision: base.revision,
      note,
      keys: keysRef.current,
    });
    if (outcome.status === "saved") {
      setBase({ status: "ready", revision: outcome.revision.revision });
      setNote("");
      setNotice({ status: "saved", revision: outcome.revision.revision });
      await loadHistory(id);
    } else {
      setNotice(outcome);
    }
    setBusy(false);
  }

  async function revert(toRevision: number) {
    if (base.status !== "ready") return;
    // A revert adds a revision for everyone and replaces the form, so it is confirmed first;
    // declining sends nothing.
    if (!window.confirm(t("specRevisions.history.confirmRevert", { revision: toRevision }))) return;
    setBusy(true);
    const outcome = await revertSpecRevision(id, toRevision, base.revision);
    if (outcome.status === "saved") {
      const revision = outcome.revision;
      setNotice(
        adopt(revision)
          ? { status: "reverted", revision: revision.revision, from: toRevision }
          : { status: "unreadable", revision: revision.revision },
      );
      await loadHistory(id);
    } else {
      setNotice(outcome);
    }
    setBusy(false);
  }

  const ready = base.status === "ready";
  const revisions = history.status === "loaded" ? [...history.data.revisions].reverse() : [];
  const latestNumber = revisions[0]?.revision ?? 0;

  return (
    <Card>
      <section aria-labelledby="spec-revisions-title" className="space-y-4">
        <div>
          <h2 id="spec-revisions-title" className="text-sm font-semibold">
            {t("specRevisions.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("specRevisions.description")}</p>
        </div>

        <p className="text-sm" data-testid="spec-revision-base">
          {base.status === "loading" ? t("specRevisions.base.loading") : null}
          {base.status === "error" ? (
            <span role="alert" className="text-status-failure">
              {t("specRevisions.base.error", { message: base.message })}
            </span>
          ) : null}
          {ready && base.revision === 0 ? t("specRevisions.base.none") : null}
          {ready && base.revision > 0 ? t("specRevisions.base.revision", { revision: base.revision }) : null}
        </p>

        <div className="space-y-2">
          <label htmlFor="spec-revision-note" className="block text-xs font-medium text-muted-foreground">
            {t("specRevisions.noteLabel")}
          </label>
          <TextInput
            id="spec-revision-note"
            value={note}
            maxLength={500}
            placeholder={t("specRevisions.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!spec || !ready} loading={busy} onClick={() => void save()}>
              {t("specRevisions.save")}
            </Button>
            {latestNumber > 0 || notice?.status === "conflict" ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void loadLatest()}>
                {t("specRevisions.loadLatest")}
              </Button>
            ) : null}
          </div>
          {/* The form's own error is already shown where it arose; this only says why saving waits. */}
          {!spec ? <p className="text-xs text-muted-foreground">{t("specRevisions.cannotSave")}</p> : null}
        </div>

        {notice ? <NoticeView notice={notice} /> : null}

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("specRevisions.history.title")}
          </h3>
          {history.status === "loading" ? <p className="text-sm text-muted-foreground">{t("specRevisions.history.loading")}</p> : null}
          {history.status === "error" ? (
            <p role="alert" className="text-sm text-status-failure">
              {t("specRevisions.history.error", { message: history.message })}
            </p>
          ) : null}
          {history.status === "loaded" && revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("specRevisions.history.empty")}</p>
          ) : null}
          {revisions.length > 0 ? (
            <ol className="space-y-2" aria-label={t("specRevisions.history.title")}>
              {revisions.map((revision) => (
                <li key={revision.revision} className="rounded-xl border border-border p-3 text-sm" data-revision={revision.revision}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t("specRevisions.history.revision", { revision: revision.revision })}</span>
                    {revision.revision === latestNumber ? (
                      <NormalStatus className="text-xs text-muted-foreground">{t("specRevisions.history.latest")}</NormalStatus>
                    ) : null}
                    {revision.reverted_from !== null ? (
                      <NormalStatus className="text-xs text-muted-foreground">
                        {t("specRevisions.history.revertedFrom", { revision: revision.reverted_from })}
                      </NormalStatus>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("specRevisions.history.byline", { author: revision.author, at: formatDateTime(revision.created_at) })}
                  </p>
                  <p className="mt-1 break-words">
                    {revision.note ?? <span className="text-muted-foreground">{t("specRevisions.history.noNote")}</span>}
                  </p>
                  {revision.revision !== latestNumber ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      disabled={busy || !ready}
                      onClick={() => void revert(revision.revision)}
                    >
                      {t("specRevisions.history.revert", { revision: revision.revision })}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {history.status === "loaded" && history.data.audit.length > 0 ? (
            <Disclosure title={t("specRevisions.audit.title", { count: history.data.audit.length })}>
              <ol className="space-y-1 text-xs" aria-label={t("specRevisions.audit.label")}>
                {history.data.audit.map((entry, index) => (
                  <li key={`${entry.revision}-${entry.at}-${index}`}>
                    {t("specRevisions.audit.entry", {
                      at: formatDateTime(entry.at),
                      author: entry.author,
                      action: t(`specRevisions.audit.action.${entry.action}`),
                      revision: entry.revision,
                    })}
                  </li>
                ))}
              </ol>
            </Disclosure>
          ) : null}
        </div>
      </section>
    </Card>
  );
}

function NoticeView({ notice }: { notice: Notice }) {
  const { t } = useTranslation();
  switch (notice.status) {
    case "saved":
      return <p role="status" className="text-sm text-status-success">{t("specRevisions.notice.saved", { revision: notice.revision })}</p>;
    case "reverted":
      return (
        <p role="status" className="text-sm text-status-success">
          {t("specRevisions.notice.reverted", { revision: notice.revision, from: notice.from })}
        </p>
      );
    case "loaded":
      return <p role="status" className="text-sm">{t("specRevisions.notice.loaded", { revision: notice.revision })}</p>;
    case "unreadable":
      return (
        <p role="alert" className="text-sm text-status-failure">
          {t("specRevisions.notice.unreadable", { revision: notice.revision })}
        </p>
      );
    case "conflict":
      return (
        <div role="alert" className="space-y-1 text-sm" data-testid="spec-revision-conflict">
          <ActionableStatus tone="warning">{t("specRevisions.notice.conflictBadge")}</ActionableStatus>
          <p>
            {notice.currentRevision === null
              ? t("specRevisions.notice.conflictUnknown")
              : t("specRevisions.notice.conflict", { revision: notice.currentRevision })}
          </p>
        </div>
      );
    case "credential":
      return (
        <div role="alert" className="space-y-1 text-sm" data-testid="spec-revision-credential">
          <ActionableStatus tone="failure">{t("specRevisions.notice.credentialBadge")}</ActionableStatus>
          <p>{t("specRevisions.notice.credential", { message: notice.message })}</p>
        </div>
      );
    case "error":
      return (
        <p role="alert" className="text-sm text-status-failure">
          {t("specRevisions.notice.error", { message: notice.message })}
        </p>
      );
  }
}
