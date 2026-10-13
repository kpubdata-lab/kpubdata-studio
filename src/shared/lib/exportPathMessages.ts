/**
 * Refused export paths said in the user's language: Studio's own check and Builder's
 * `unsafe_export_path`, `reserved_export_path` and `export_path_collision` refusals
 * (kpubdata-builder#1320).
 */
import { i18n } from "@/shared/i18n";
import { EXPORT_PATH_CODES, type ExportPathCode, type ExportPathProblem } from "@/shared/lib/exportPaths";

/**
 * A refused export path, said in the user's language.
 *
 * @param problem - The refused export and why.
 */
export function describeExportPathProblem(problem: ExportPathProblem): string {
  return i18n.t(`exportPaths.${problem.code}`, { n: problem.index + 1 });
}

/** Builder's export-path refusals in a `structured_problems` list, keyed by its own message. */
function builderExportPathProblems(body: unknown): Map<string, string> {
  const found = new Map<string, string>();
  if (!body || typeof body !== "object") return found;
  const structured = (body as { structured_problems?: unknown }).structured_problems;
  if (!Array.isArray(structured)) return found;
  for (const item of structured) {
    if (!item || typeof item !== "object") continue;
    const { code, path, message } = item as { code?: unknown; path?: unknown; message?: unknown };
    if (!EXPORT_PATH_CODES.includes(code as ExportPathCode)) continue;
    const index = typeof path === "string" ? /^exports\[(\d+)\]/.exec(path)?.[1] : undefined;
    const friendly = describeExportPathProblem({ index: Number(index ?? 0), code: code as ExportPathCode });
    found.set(typeof message === "string" ? message : friendly, friendly);
  }
  return found;
}

/**
 * Builder's export-path refusals in a `{status: "invalid", structured_problems}` body,
 * said in the user's language, or `null` when the body has none.
 *
 * @param body - Parsed Builder response body.
 */
export function builderExportPathMessages(body: unknown): string[] | null {
  const found = [...builderExportPathProblems(body).values()];
  return found.length > 0 ? found : null;
}

/**
 * Builder's `problems` strings with each export-path refusal said in the user's language;
 * other problems are kept as Builder wrote them.
 *
 * @param body - Parsed Builder response body, holding `structured_problems`.
 * @param problems - Builder's `problems` strings.
 */
export function localizeBuilderProblems(body: unknown, problems: string[]): string[] {
  const found = builderExportPathProblems(body);
  return problems.map((problem) => found.get(problem) ?? problem);
}
