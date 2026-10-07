/**
 * The key notice for a build that was just refused or just failed for want of a key
 * (#787) — the one place the two build screens (edit a table, add data) decide whether
 * to show it, so they cannot answer the same failure differently.
 */
import { useLocation } from "react-router-dom";
import type { BuildJob } from "@/features/runs/useBuildJob";
import type { MissingProviderKeys } from "@/shared/lib/missingProviderKey";
import type { BuildSpec } from "@/shared/lib/types";
import { MissingProviderKeyNotice } from "./MissingProviderKeyNotice";

/** The providers a spec's public-API sources call, lower-cased, without repeats. */
export function providersOf(spec: BuildSpec): string[] {
  const names = spec.sources
    .filter((source) => (source.kind ?? "public_api") === "public_api")
    .map((source) => (source.provider ?? "").trim().toLowerCase())
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}

/**
 * The notice, with the page it is on as the place to come back to. The router is asked
 * only here — when there is a notice to show — so a screen that never shows one renders
 * without a router around it, as its tests do.
 */
function NoticeHere({ missing, reason }: { missing: MissingProviderKeys; reason: "refused" | "lost" }) {
  const { pathname, search } = useLocation();
  return <MissingProviderKeyNotice missing={missing} reason={reason} returnTo={`${pathname}${search}`} />;
}

/** Shows nothing unless the key is what stands between the user and the build. */
export function BuildKeyNotice({ job }: { job: Pick<BuildJob, "status" | "missingKeys" | "run"> }) {
  if (job.status !== "failed") return null;
  if (job.missingKeys) return <NoticeHere missing={job.missingKeys} reason="refused" />;
  if (job.run?.keysLost) {
    // Builder does not say which keys a finished run lost; they are the ones its spec
    // calls with. Keys are lost only where they travel with each request.
    const lost: MissingProviderKeys = { providers: providersOf(job.run.spec), keptIn: "request" };
    return lost.providers.length > 0 ? <NoticeHere missing={lost} reason="lost" /> : null;
  }
  return null;
}

/** The same notice for a preview that Builder refused for a missing key. */
export function PreviewKeyNotice({ missing }: { missing: MissingProviderKeys | undefined }) {
  return missing ? <NoticeHere missing={missing} reason="refused" /> : null;
}
