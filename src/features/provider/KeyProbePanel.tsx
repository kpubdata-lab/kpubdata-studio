/**
 * What the key held for this session reaches, per dataset (#410, kpubdata-builder#802).
 *
 * Builder probes with the key in `X-Provider-Key` — the one this tab holds in memory — and
 * answers each dataset with one of kpubdata's probe statuses. Builder stores neither the
 * key nor the result, and neither does this panel: the result lives in component state
 * and is gone when the panel unmounts (another provider, the key forgotten, a reload).
 *
 * - A status that needs the user to act (apply at the provider, check the key) is a badge;
 *   `available` is plain text (#524).
 * - A status this Studio does not know is shown as Builder sent it, not hidden: a newer
 *   kpubdata may add one.
 * - A dataset Builder did not reach (`not_probed`) gets no status. Nothing was observed
 *   about it, and the panel says so.
 * - Builder lets a user probe a provider only so often (kpubdata-builder#1059). A probe
 *   refused for that is not a failure: the panel says how long to wait.
 * - No key text is rendered, and none is put in an error message.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { builderApi, isRealBuilderEnabled, type ProviderProbeResponse } from "@/shared/lib/builderApi";
import { Button } from "@/shared/ui";

import { probeRateLimited } from "./probeRefusal";
import { ActionableStatus, NormalStatus, type ActionTone } from "@/shared/ui/StatusState";

/** kpubdata's `PROBE_STATUSES`, and how each reads here. `null` tone: plain text. */
const KNOWN: Record<string, ActionTone | null> = {
  available: null,
  auth_unknown: "warning",
  application_required: "warning",
  params_invalid: null,
  rate_limited: "warning",
  temporarily_unavailable: "warning",
  network_error: "warning",
  insufficient_metadata: null,
  retired: null,
};

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: ProviderProbeResponse }
  | { status: "wait"; seconds: number | null }
  | { status: "error" };

/** Demo answer for mock mode: one of each outcome a user most often meets. */
function mockProbe(provider: string): ProviderProbeResponse {
  return {
    provider,
    probed_at: "2026-10-06T09:30:00+00:00",
    complete: true,
    datasets: [
      { dataset: "apt_trade", service_id: "RTMSDataSvcAptTradeDev", status: "available", detail: "", http_status: 200 },
      { dataset: "apt_rent", service_id: "RTMSDataSvcAptRent", status: "application_required", detail: "", http_status: 200 },
    ],
    not_probed: [],
  };
}

export function KeyProbePanel({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  const run = async () => {
    setState({ status: "loading" });
    try {
      const result = isRealBuilderEnabled() ? await builderApi.probeProviderKey(provider) : mockProbe(provider);
      setState({ status: "loaded", result });
    } catch (cause) {
      const limited = probeRateLimited(cause);
      if (limited) {
        setState({ status: "wait", seconds: limited.retryAfterSeconds });
        return;
      }
      // The cause is not shown: an upstream error text is the one place a key could ride.
      setState({ status: "error" });
    }
  };

  return (
    <section aria-label={t("provider.keyProbe.title")} className="space-y-3 rounded-lg border border-border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">{t("provider.keyProbe.title")}</h3>
          <p className="mt-1 text-muted-foreground">{t("provider.keyProbe.body")}</p>
        </div>
        <Button size="sm" variant="secondary" disabled={state.status === "loading"} onClick={() => void run()}>
          {state.status === "loading"
            ? t("provider.keyProbe.running")
            : state.status === "idle"
              ? t("provider.keyProbe.run")
              : t("provider.keyProbe.runAgain")}
        </Button>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-status-failure">{t("provider.keyProbe.failed")}</p>
      ) : null}

      {state.status === "wait" ? (
        <p role="status" className="text-muted-foreground">
          {state.seconds === null
            ? t("provider.keyProbe.wait")
            : t("provider.keyProbe.waitSeconds", { seconds: state.seconds })}
        </p>
      ) : null}

      {state.status === "loaded" ? (
        <>
          {state.result.datasets.length === 0 ? (
            <p className="text-muted-foreground">{t("provider.keyProbe.none")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t("provider.keyProbe.columns.dataset")}</th>
                    <th scope="col" className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t("provider.keyProbe.columns.status")}</th>
                    <th scope="col" className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t("provider.keyProbe.columns.next")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.result.datasets.map((item) => {
                    const known = item.status in KNOWN;
                    const tone = known ? KNOWN[item.status] : null;
                    const label = known ? t(`provider.keyProbe.status.${item.status}.label`) : item.status;
                    return (
                      <tr key={item.dataset} className="border-b border-border last:border-0">
                        <th scope="row" className="px-2 py-1.5 font-normal">
                          <span className="font-mono text-xs text-foreground">{item.dataset}</span>
                          <span className="block text-xs text-muted-foreground">{item.service_id}</span>
                        </th>
                        <td className="px-2 py-1.5">
                          {tone ? <ActionableStatus tone={tone}>{label}</ActionableStatus> : <NormalStatus>{label}</NormalStatus>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {known ? t(`provider.keyProbe.status.${item.status}.next`) : t("provider.keyProbe.unknownStatus")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {state.result.not_probed.length > 0 ? (
            <p className="text-muted-foreground">
              {t("provider.keyProbe.notProbed", { datasets: state.result.not_probed.join(", ") })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("provider.keyProbe.notKept")}</p>
        </>
      ) : null}
    </section>
  );
}
