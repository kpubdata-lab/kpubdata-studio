/**
 * Where the user is, for the topbar (#423).
 *
 * The topbar used to repeat the product name and a tagline that the sidebar logo
 * already said. That space now names what is being looked at —
 * `Tables / air-quality`, `Refresh Jobs / run-1 / Snapshot Files`. The first crumb is
 * the sidebar section the page belongs to, so the two always agree; the rest come
 * from the path. Old URLs redirect before they get here (legacyRedirect.tsx).
 */

export interface Crumb {
  label: string;
  /** Absent on the last crumb, which is the current page. */
  to?: string;
}

type Translate = (key: string) => string;

/** First path segment → the sidebar entry it lives under. */
const SECTIONS: Record<string, { labelKey: string; to: string }> = {
  discover: { labelKey: "nav.discover", to: "/discover" },
  add: { labelKey: "nav.discover", to: "/discover" },
  tables: { labelKey: "nav.datasets", to: "/tables" },
  "refresh-jobs": { labelKey: "nav.builds", to: "/refresh-jobs" },
  sql: { labelKey: "nav.sql", to: "/sql" },
  quality: { labelKey: "nav.quality", to: "/quality" },
  monitoring: { labelKey: "nav.monitoring", to: "/monitoring" },
  workspace: { labelKey: "nav.workspace", to: "/workspace" },
  reports: { labelKey: "nav.reports", to: "/reports" },
  connections: { labelKey: "nav.provider", to: "/connections" },
  settings: { labelKey: "nav.settings", to: "/settings" },
  assistant: { labelKey: "router.features.Assistant", to: "/assistant" },
  validate: { labelKey: "router.features.validate", to: "/validate" },
  preview: { labelKey: "router.features.preview", to: "/preview" },
  artifacts: { labelKey: "router.features.artifacts", to: "/artifacts" },
};

/** Trailing segment under `/refresh-jobs/:id/…` → its page name. */
const RUN_PAGES: Record<string, string> = {
  run: "router.features.buildRun",
  artifacts: "router.features.artifacts",
  publish: "router.features.publish",
  edit: "router.features.buildEdit",
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The crumbs for `pathname`; the last one has no link. */
export function crumbsFor(pathname: string, t: Translate): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: t("nav.home") }];

  const [head, ...rest] = segments;
  const section = SECTIONS[head];
  if (!section) return [{ label: decode(pathname) }];

  const crumbs: Crumb[] = [{ label: t(section.labelKey), to: section.to }];
  if (head === "add") crumbs.push({ label: t("router.features.AddData") });
  else if (head === "refresh-jobs" && rest[0] === "new") crumbs.push({ label: t("router.features.newBuild") });
  else if (rest.length > 0) {
    const id = rest[0];
    const page = head === "refresh-jobs" && rest[1] ? RUN_PAGES[rest[1]] : undefined;
    crumbs.push({ label: decode(id), to: page ? `/${head}/${id}` : undefined });
    if (page) crumbs.push({ label: t(page) });
  }

  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}
