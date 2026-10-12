/**
 * Is the signed-in user an administrator? (#409)
 *
 * KPubData Builder has no "who am I" endpoint, so this asks the cheapest admin-only
 * one: `GET /admin/config` answers 200 to an administrator and 403 to anyone else.
 * Anything else — a network error, an Builder older than the admin role (404), mock
 * mode — is "unknown", and unknown hides the menu. Hiding is a convenience: the
 * Builder's 403 is the actual block, and the admin screen shows it when reached by URL.
 */
import { create } from "zustand";

import { ApiError, builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";

export type AdminStatus = "unknown" | "admin" | "not_admin";

interface AdminState {
  status: AdminStatus;
}

export const useAdminStore = create<AdminState>(() => ({ status: "unknown" }));

let inFlight: Promise<void> | null = null;
/** Counts resets, so a probe that started for the previous account cannot answer for this one (#902). */
let generation = 0;

/** Classify one `GET /admin/config` outcome. */
export function classifyAdminProbe(outcome: { ok: true } | { ok: false; cause: unknown }): AdminStatus {
  if (outcome.ok) return "admin";
  return outcome.cause instanceof ApiError && outcome.cause.status === 403 ? "not_admin" : "unknown";
}

export function ensureAdminChecked(): Promise<void> {
  if (!isRealBuilderEnabled()) return Promise.resolve();
  if (inFlight) return inFlight;
  const asked = generation;
  inFlight = builderApi
    .adminConfig()
    .then(() => {
      if (asked === generation) useAdminStore.setState({ status: classifyAdminProbe({ ok: true }) });
    })
    .catch((cause: unknown) => {
      if (asked !== generation) return;
      const status = classifyAdminProbe({ ok: false, cause });
      useAdminStore.setState({ status });
      // A 403 is an answer; anything else is not, so the next call asks again (#480).
      if (status === "unknown") inFlight = null;
    });
  return inFlight;
}

/** Forget the previous check: the answer was about the account that asked (#902). Also used by tests. */
export function resetAdminCheck(): void {
  generation++;
  inFlight = null;
  useAdminStore.setState({ status: "unknown" });
}
