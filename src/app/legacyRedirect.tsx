/**
 * Old build-console URLs keep working (#423).
 *
 * The warehouse IA renamed `/datasets` → `/tables`, `/builds` → `/refresh-jobs` and
 * `/provider` → `/connections`. Saved links, bookmarks and links pasted into reports
 * still point at the old ones, so each old prefix redirects to the new one with the
 * rest of the path, the query (`?run=`, `?returnTo=`) and the hash intact. `replace`
 * keeps the old URL out of history, so Back does not bounce through the redirect.
 */
import { Navigate, useLocation } from "react-router-dom";

/** The old → new prefixes. Order does not matter: no prefix is a prefix of another. */
export const LEGACY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["/datasets", "/tables"],
  ["/builds", "/refresh-jobs"],
  ["/provider", "/connections"],
];

/** Where an old URL now lives; `null` when it is not an old URL. */
export function legacyTarget(pathname: string, search = "", hash = ""): string | null {
  for (const [from, to] of LEGACY_PREFIXES) {
    if (pathname === from || pathname.startsWith(`${from}/`)) {
      return `${to}${pathname.slice(from.length)}${search}${hash}`;
    }
  }
  return null;
}

export function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={legacyTarget(pathname, search, hash) ?? "/"} />;
}
