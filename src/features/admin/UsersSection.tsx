/**
 * Users and sign-up approval (#409) over the Builder sign-up ledger (kpubdata-builder#785).
 *
 * Each row is what the ledger returns — an irreversible id (shown as a short hash), a
 * display name, the status and who decided it. No credential exists in the ledger, and
 * the response schema strips anything the contract does not define. Approving or
 * rejecting asks for confirmation first and then shows the Builder's answer: the row is
 * replaced by the entry the Builder returns, and a refusal (403, 404) is shown as one
 * rather than as a changed status.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "@/features/datasets/model";
import { ApiError, builderApi, type AdminUser } from "@/shared/lib/builderApi";
import { Button } from "@/shared/ui";
import { ActionableStatus, MissingStatus, NormalStatus } from "@/shared/ui/StatusState";

type Decision = "approve" | "reject";

const SHORT_HASH = 12;

function shortHash(value: string): string {
  return value.slice(0, SHORT_HASH);
}

export function UsersSection({ users, onChange }: { users: AdminUser[]; onChange: (user: AdminUser) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = users.filter((user) => user.status === "pending").length;

  async function decide(user: AdminUser, decision: Decision) {
    const name = user.display_name ?? shortHash(user.user_id);
    const question = decision === "approve" ? t("admin.users.confirmApprove", { name }) : t("admin.users.confirmReject", { name });
    if (!window.confirm(question)) return;
    setBusy(user.user_id);
    setError(null);
    try {
      const updated =
        decision === "approve" ? await builderApi.adminApproveUser(user.user_id) : await builderApi.adminRejectUser(user.user_id);
      onChange(updated);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) setError(t("admin.users.decisionForbidden"));
      else if (cause instanceof ApiError && cause.status === 404) setError(t("admin.users.decisionNotFound", { name }));
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="px-5 pt-3 text-xs text-muted-foreground">
        {pending > 0 ? (
          <ActionableStatus tone="warning">{t("admin.users.pendingCount", { n: pending })}</ActionableStatus>
        ) : (
          <NormalStatus>{t("admin.users.nonePending")}</NormalStatus>
        )}
      </p>
      {error ? (
        <p className="px-5 pt-3 text-sm text-status-failure" role="alert">
          {error}
        </p>
      ) : null}
      {users.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t("admin.users.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t("admin.users.tableLabel")} className="mt-3 w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-semibold">{t("admin.users.colName")}</th>
                <th className="px-4 py-2 font-semibold">{t("admin.users.colId")}</th>
                <th className="px-4 py-2 font-semibold">{t("admin.colStatus")}</th>
                <th className="px-4 py-2 font-semibold">{t("admin.users.colFirstSeen")}</th>
                <th className="px-4 py-2 font-semibold">{t("admin.users.colLastSeen")}</th>
                <th className="px-4 py-2 font-semibold">{t("admin.users.colDecided")}</th>
                <th className="px-4 py-2 font-semibold">{t("admin.users.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const name = user.display_name ?? shortHash(user.user_id);
                return (
                  <tr className="border-t border-border" key={user.user_id}>
                    <td className="px-4 py-2">{user.display_name ?? <MissingStatus />}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{shortHash(user.user_id)}</td>
                    <td className="px-4 py-2">
                      <SignupStatus status={user.status} />
                    </td>
                    <td className="px-4 py-2 text-xs">{formatDateTime(user.first_seen_at)}</td>
                    <td className="px-4 py-2 text-xs">{formatDateTime(user.last_seen_at)}</td>
                    <td className="px-4 py-2 text-xs">
                      {user.decided_at ? <span className="block">{formatDateTime(user.decided_at)}</span> : null}
                      {user.decided_by === null ? (
                        <MissingStatus />
                      ) : user.decided_by === "allowlist" ? (
                        <span className="text-muted-foreground">{t("admin.users.byAllowlist")}</span>
                      ) : (
                        <span className="font-mono text-muted-foreground" title={t("admin.users.byAdmin")}>
                          {shortHash(user.decided_by)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {user.status !== "approved" ? (
                          <Button
                            aria-label={t("admin.users.approveLabel", { name })}
                            disabled={busy !== null}
                            loading={busy === user.user_id}
                            onClick={() => void decide(user, "approve")}
                            size="sm"
                            variant="secondary"
                          >
                            {t("admin.users.approve")}
                          </Button>
                        ) : null}
                        {user.status !== "rejected" ? (
                          <Button
                            aria-label={t("admin.users.rejectLabel", { name })}
                            disabled={busy !== null}
                            loading={busy === user.user_id}
                            onClick={() => void decide(user, "reject")}
                            size="sm"
                            variant="ghost"
                          >
                            {t("admin.users.reject")}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SignupStatus({ status }: { status: AdminUser["status"] }) {
  const { t } = useTranslation();
  if (status === "pending") return <ActionableStatus tone="warning">{t("admin.users.status.pending")}</ActionableStatus>;
  return <NormalStatus>{t(`admin.users.status.${status}`)}</NormalStatus>;
}
