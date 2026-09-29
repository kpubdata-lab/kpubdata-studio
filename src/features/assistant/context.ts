/**
 * Resolver converting current route to `AssistantContext` (#256).
 *
 * Builds only "context obtainable from current actual route" — reuses Dataset Detail/Quality
 * query convention `?run=&source=&stage=` (#253/#254) as-is, doesn't guess other values
 * (e.g., provider of unfetched dataset). `qualityResultIds` unknowable from route alone,
 * so `useAssistantSession` fills separately after evidence loads.
 */
import { i18n } from "@/shared/i18n";
import { ASSISTANT_STAGES } from "./schema";
import type { AssistantContext, AssistantStage } from "./types";

interface RouteMatch {
  test: RegExp;
  page: string;
  /** Screen name i18n key (`assistant.context.page.*`) — don't hardcode text in constants (#350). */
  labelKey: string;
}

// Order matters: more specific patterns (defined earlier) must match first (#247 ROUTE_LABELS same principle).
const ROUTES: RouteMatch[] = [
  { test: /^\/$/, page: "home", labelKey: "home" },
  { test: /^\/discover(\/|$)/, page: "discover", labelKey: "discover" },
  { test: /^\/workspace(\/|$)/, page: "workspace", labelKey: "workspace" },
  { test: /^\/add(\/|$)/, page: "add-data", labelKey: "add-data" },
  { test: /^\/datasets\/[^/]+/, page: "dataset-detail", labelKey: "dataset-detail" },
  { test: /^\/datasets(\/|$)/, page: "dataset-catalog", labelKey: "dataset-catalog" },
  { test: /^\/builds\/new(\/|$)/, page: "build-new", labelKey: "build-new" },
  { test: /^\/builds\/[^/]+\/run(\/|$)/, page: "build-run", labelKey: "build-run" },
  { test: /^\/builds\/[^/]+\/artifacts(\/|$)/, page: "build-artifacts", labelKey: "build-artifacts" },
  { test: /^\/builds\/[^/]+\/publish(\/|$)/, page: "build-publish", labelKey: "build-publish" },
  { test: /^\/builds\/[^/]+\/edit(\/|$)/, page: "build-edit", labelKey: "build-edit" },
  { test: /^\/builds\/[^/]+(\/|$)/, page: "build-detail", labelKey: "build-detail" },
  { test: /^\/builds(\/|$)/, page: "builds", labelKey: "builds" },
  { test: /^\/quality(\/|$)/, page: "quality", labelKey: "quality" },
  { test: /^\/assistant(\/|$)/, page: "assistant", labelKey: "assistant" },
  { test: /^\/reports(\/|$)/, page: "reports", labelKey: "reports" },
  { test: /^\/provider(\/|$)/, page: "provider", labelKey: "provider" },
  { test: /^\/monitoring(\/|$)/, page: "monitoring", labelKey: "monitoring" },
  { test: /^\/settings(\/|$)/, page: "settings", labelKey: "settings" },
  { test: /^\/validate(\/|$)/, page: "validate", labelKey: "validate" },
  { test: /^\/preview(\/|$)/, page: "preview", labelKey: "preview" },
  { test: /^\/artifacts(\/|$)/, page: "artifacts", labelKey: "artifacts" },
];

function isAssistantStage(value: string | null): value is AssistantStage {
  return value !== null && (ASSISTANT_STAGES as readonly string[]).includes(value);
}

/** Minimal Assistant route context needed at App Shell level (#247 AssistantRouteContext same purpose). */
export interface AssistantRouteResolution {
  context: AssistantContext;
  /** Human-readable current screen name to display in drawer header. */
  pageLabel: string;
  /** Whether run parameter from URL is valid context value for this screen (currently always true — route parsing only). */
  pathname: string;
}

/**
 * Convert current pathname + search to `AssistantContext`.
 *
 * @param pathname - Current path (e.g., `/datasets/abc`).
 * @param search - Current querystring (e.g., `?run=r1&stage=silver`, leading `?` optional).
 * @returns AssistantContext obtainable from route and screen label.
 */
export function resolveAssistantContext(pathname: string, search = ""): AssistantRouteResolution {
  const matched = ROUTES.find((entry) => entry.test.test(pathname));
  const page = matched?.page ?? "other";
  // Screen name currently localized — matched route uses labelKey as-is if path doesn't match.
  const pageLabel = matched ? i18n.t(`assistant.context.page.${matched.labelKey}`) : pathname;

  const params = new URLSearchParams(search);

  const datasetMatch = pathname.match(/^\/datasets\/([^/]+)/);
  const buildMatch = pathname.match(/^\/builds\/([^/]+)/);
  const buildId = buildMatch && buildMatch[1] !== "new" ? decodeURIComponent(buildMatch[1]) : undefined;

  const datasetId = datasetMatch
    ? decodeURIComponent(datasetMatch[1])
    : (params.get("dataset") ?? undefined);
  // Dataset Detail/Quality both use build/run identifier as `run` query (#253/#254 convention).
  // Build route: path buildId itself is run_id (Builder writes run_id to artifact directory).
  const runId = buildId ?? (params.get("run") ?? undefined);
  const stageParam = params.get("stage");
  const stage = isAssistantStage(stageParam) ? stageParam : undefined;
  // Dataset Detail/Quality pass selected source as `?source=` (#253/#254). Empty string
  // ("entire source") is explicit select, so doesn't pass to context.
  const source = params.get("source") || undefined;

  const context: AssistantContext = {
    page,
    ...(datasetId ? { datasetId } : {}),
    ...(runId ? { runId } : {}),
    ...(stage ? { stage } : {}),
    ...(source ? { source } : {}),
  };

  return { context, pageLabel, pathname };
}

/** Check if two AssistantContexts refer to same context (by page/datasetId/runId/stage criteria). */
export function contextsMatch(a: AssistantContext, b: AssistantContext): boolean {
  return (
    a.page === b.page &&
    (a.datasetId ?? null) === (b.datasetId ?? null) &&
    (a.runId ?? null) === (b.runId ?? null) &&
    (a.stage ?? null) === (b.stage ?? null) &&
    (a.source ?? null) === (b.source ?? null)
  );
}
