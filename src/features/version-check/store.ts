/**
 * The one place the Studio ↔ Builder release comparison is kept (#430).
 *
 * Checked once per page load: the answer cannot change without reloading one side,
 * and asking on every request would double the traffic for nothing.
 */
import { create } from "zustand";

import { builderApi } from "@/shared/lib/builderApi";

import { compareAppVersion, type AppVersionComparison } from "./compareAppVersion";

/** Studio's own version, injected at build time from `package.json`. */
export const STUDIO_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "";

interface VersionCheckState {
  /** `null` until the check has run. A failed request stays `null` — no verdict. */
  comparison: AppVersionComparison | null;
  /** The Engine's HTTP contract version from the same response; `null` until known (#482). */
  apiVersion: string | null;
  /** Whether the user closed the banner for this page load. */
  dismissed: boolean;
  dismiss: () => void;
}

export const useVersionCheckStore = create<VersionCheckState>((set) => ({
  comparison: null,
  apiVersion: null,
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

let inFlight: Promise<void> | null = null;

/**
 * Ask Builder for its version once and record the comparison.
 *
 * A failed request records nothing: connection errors already surface where the
 * failing call is made, and a mismatch banner on top of them would be a guess. It also
 * does not stick — the next call asks again (#480), so an Engine that was down when
 * the page loaded is compared once it answers. A success is kept for the page load.
 */
export function ensureVersionChecked(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = builderApi
    .version()
    .then((info) => {
      const comparison = compareAppVersion(STUDIO_VERSION, info.version);
      if (comparison.kind === "patch") {
        console.info(`Studio ${comparison.studio} and KPubData Engine ${comparison.builder} differ by a patch release.`);
      }
      useVersionCheckStore.setState({ comparison, apiVersion: info.api_version });
    })
    .catch(() => {
      // No verdict — see above — and no cached promise, so the next call retries.
      inFlight = null;
    });
  return inFlight;
}

/** Test-only: forget the previous check. */
export function resetVersionCheck(): void {
  inFlight = null;
  useVersionCheckStore.setState({ comparison: null, apiVersion: null, dismissed: false });
}
