/**
 * Which warehouse table names a query uses as a relation (#528).
 *
 * KPubData Builder reads one table per query, always as the logical relation `dataset`;
 * a table's own name in `FROM` is refused when the query runs. Finding it here lets the
 * SQL Workspace say so before the person runs it. Only names the caller actually has are
 * matched — a CTE or a typo is left for the Builder to answer.
 */

/** Drop string literals and comments so a name inside them is not read as a relation. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Table logical names (spelled as in `names`) that follow `FROM` or `JOIN`, case-insensitively. */
export function referencedTableNames(sql: string, names: readonly string[]): string[] {
  const known = new Map(names.map((name) => [name.toLowerCase(), name]));
  const found: string[] = [];
  const pattern = /\b(?:from|join)\s+(?:"([^"]+)"|([A-Za-z_][\w.-]*))/gi;
  for (const match of stripLiterals(sql).matchAll(pattern)) {
    const name = known.get((match[1] ?? match[2] ?? "").toLowerCase());
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** A column name as a SQL identifier: bare when it is a plain lower-case identifier, quoted otherwise. */
export function sqlIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}
