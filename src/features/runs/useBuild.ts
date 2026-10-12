/**
 * Build data loading hook.
 *
 * Fetch build info by buildId and manage loading/error state. A new run id, or another
 * account signing in, drops what was loaded and aborts the request still out (#902).
 */
import { i18n } from "@/shared/i18n";
import { useEffect, useState } from "react";
import { useStorageOwnerKey } from "@/features/auth/storageOwner";
import { getBuild } from "./api/getBuild";
import type { BuildRun } from "@/shared/lib/types";

export interface UseBuildResult {
  build: BuildRun | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to load build info by buildId.
 *
 * @param buildId - build ID to query.
 * @returns build data and loading state.
 */
export function useBuild(buildId: string): UseBuildResult {
  const owner = useStorageOwnerKey();
  const [state, setState] = useState<{
    build: BuildRun | null;
    isLoading: boolean;
    error: string | null;
  }>({
    build: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadBuild() {
      if (!buildId) {
        setState({ build: null, isLoading: false, error: i18n.t("runs.errors.missingId") });
        return;
      }

      setState({ build: null, isLoading: true, error: null });

      try {
        const build = await getBuild(buildId, controller.signal);
        if (!controller.signal.aborted) {
          setState({ build, isLoading: false, error: null });
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setState({
            build: null,
            isLoading: false,
            error: cause instanceof Error ? cause.message : i18n.t("runs.errors.loadFailed"),
          });
        }
      }
    }

    loadBuild();

    return () => controller.abort();
  }, [buildId, owner]);

  return state;
}
