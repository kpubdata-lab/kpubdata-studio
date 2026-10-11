/**
 * Old build-console URLs keep working (#423).
 *
 * The warehouse IA renamed `/datasets` → `/tables`, `/builds` → `/refresh-jobs` and
 * `/provider` → `/connections`. Saved links, bookmarks and links pasted into reports
 * still point at the old ones, so each old prefix redirects to the new one with the
 * rest of the path, the query (`?run=`, `?returnTo=`) and the hash intact. `replace`
 * keeps the old URL out of history, so Back does not bounce through the redirect.
 *
 * The three stand-alone pages of the old flow (`SUPERSEDED_PAGES`) redirect the same way.
 * INFORMATION_ARCHITECTURE.md, section 3.1, records why.
 */
import { Navigate, useLocation } from "react-router-dom";

/** The old → new prefixes. Order does not matter: no prefix is a prefix of another. */
export const LEGACY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["/datasets", "/tables"],
  ["/builds", "/refresh-jobs"],
  ["/provider", "/connections"],
];

/**
 * Stand-alone pages whose function moved into another screen (#423).
 *
 * `/validate` and `/preview` were steps of their own before the creation flow at `/add`
 * took validation and preview in as its steps (#534), and `/artifacts` was a list of
 * files before files belonged to a run. Each had become a page with nothing on it but a
 * button to the screen named here, so the URL goes there directly. These match the
 * exact path only: nothing ever lived under them.
 */
export const SUPERSEDED_PAGES: ReadonlyArray<readonly [string, string]> = [
  ["/validate", "/add"],
  ["/preview", "/add"],
  ["/artifacts", "/refresh-jobs"],
];

/** Where an old URL now lives; `null` when it is not an old URL. */
export function legacyTarget(pathname: string, search = "", hash = ""): string | null {
  const page = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [from, to] of SUPERSEDED_PAGES) {
    if (page === from) return `${to}${search}${hash}`;
  }
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
