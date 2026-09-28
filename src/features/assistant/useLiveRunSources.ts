import { useEffect, useState } from "react";
import { listBuildStages } from "@/features/datasets/api";

/**
 * Return the source_key values that Builder confirmed for the currently-live Run.
 *
 * Immediately clear previous Run sources so they are not briefly exposed while fetching a
 * new Run.
 *
 * On fetch failure do not invent candidate sources; keep the picker empty.
 */
export function useLiveRunSources(runId?: string): string[] {
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    // Immediately clear previous Run sources so they are not briefly exposed while fetching a new Run.
    setSources([]);
    if (!runId) return () => controller.abort();

    void listBuildStages(runId, controller.signal)
      .then((response) => {
        if (!current || controller.signal.aborted || response.run_id !== runId) return;
        setSources([...new Set(response.sources.map((source) => source.source_key))]);
      })
      .catch(() => {
        // On fetch failure do not invent candidate sources; keep the picker empty.
        if (current && !controller.signal.aborted) setSources([]);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [runId]);

  return sources;
}
