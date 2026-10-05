/**
 * What a user can do when a publish ends `publish_state_unknown` (#728).
 *
 * Builder blocks a retry while it does not know whether the publish went through: sending
 * it again could publish twice. It offers two ways out, and this panel is where Studio
 * calls them:
 *
 * - **Check the remote** (`reconcile`): Builder looks at the destination. If it is there,
 *   the publish did go through; if not, the receipt is removed and the publish can be sent
 *   again.
 * - **Reset the record** (`reset`): the receipt is deleted without looking. Nothing is
 *   undone remotely, so this asks for a second, explicit click.
 *
 * Neither is ever called automatically. A deployment that takes the publish credential
 * from the request needs the token again for the remote check — Studio dropped it when
 * the publish started (#615).
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  reconcilePublish,
  resetPublishReceipt,
  type PublishCredential,
  type PublishRecoveryOutcome,
} from "@/features/publish/api";
import { Button } from "@/shared/ui";

interface Props {
  runId: string;
  destination: string;
  /** The deployment reads the publish credential from the request, so the check needs a token. */
  needsCredential: boolean;
  /** Takes the token entered on the page, and clears it there: used for one request only. */
  takeCredential: () => PublishCredential | undefined;
  /** Called when nothing blocks a new publish any more. */
  onRetryAllowed: () => void;
}

const RETRY_ALLOWED: ReadonlySet<PublishRecoveryOutcome["kind"]> = new Set(["absent", "reset", "nothing_to_settle"]);

export function PublishRecoveryPanel({ runId, destination, needsCredential, takeCredential, onRetryAllowed }: Props) {
  const { t } = useTranslation();
  const [working, setWorking] = useState<"reconcile" | "reset" | null>(null);
  const [outcome, setOutcome] = useState<PublishRecoveryOutcome>();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [credentialMissing, setCredentialMissing] = useState(false);
  const inFlight = useRef(false);

  async function run(action: "reconcile" | "reset") {
    if (inFlight.current) return;
    const credential = needsCredential ? takeCredential() : undefined;
    // The remote can only be read with the requester's own credential (builder#925).
    if (action === "reconcile" && needsCredential && !credential) {
      setCredentialMissing(true);
      return;
    }
    inFlight.current = true;
    setCredentialMissing(false);
    setWorking(action);
    setOutcome(undefined);
    try {
      const call = action === "reconcile" ? reconcilePublish : resetPublishReceipt;
      setOutcome(await call(runId, destination, undefined, credential));
    } finally {
      inFlight.current = false;
      setWorking(null);
      setConfirmingReset(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground" data-publish-recovery>
      <h3 className="font-semibold">{t("buildPublish.recovery.title")}</h3>
      <p className="mt-1 text-muted-foreground">{t("buildPublish.recovery.explain")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button size="sm" loading={working === "reconcile"} disabled={working !== null} onClick={() => void run("reconcile")}>
          {t("buildPublish.recovery.reconcile")}
        </Button>
        {confirmingReset ? (
          <Button size="sm" variant="secondary" loading={working === "reset"} disabled={working !== null} onClick={() => void run("reset")}>
            {t("buildPublish.recovery.resetConfirm")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={working !== null} onClick={() => setConfirmingReset(true)}>
            {t("buildPublish.recovery.reset")}
          </Button>
        )}
      </div>
      {confirmingReset ? <p className="mt-2 text-xs text-status-warning">{t("buildPublish.recovery.resetWarning")}</p> : null}
      {credentialMissing ? <p className="mt-2 text-xs text-status-warning" role="alert">{t("buildPublish.recovery.tokenNeeded")}</p> : null}
      {outcome ? (
        <div className="mt-3" role="status" data-recovery-outcome={outcome.kind}>
          <p>{outcome.kind === "failed" ? outcome.message : t(`buildPublish.recovery.outcome.${outcome.kind}`)}</p>
          {RETRY_ALLOWED.has(outcome.kind) ? (
            <Button className="mt-2" size="sm" variant="secondary" onClick={onRetryAllowed}>
              {t("buildPublish.recovery.publishAgain")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
