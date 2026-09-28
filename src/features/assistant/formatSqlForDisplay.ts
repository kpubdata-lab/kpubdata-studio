/**
 * Minimal formatter for Drawer display, separate from SQL execution source.
 * Track string/comment/paren depth to break lines only before top-level clauses.
 */
const SINGLE_CLAUSES = new Set(["FROM", "WHERE", "HAVING", "LIMIT", "OFFSET", "UNION"]);
const JOIN_MODIFIERS = new Set(["LEFT", "RIGHT", "FULL", "INNER", "CROSS", "NATURAL"]);

interface WordToken {
  value: string;
  start: number;
  depth: number;
}

function topLevelWords(sql: string): WordToken[] {
  const words: WordToken[] = [];
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      } else if (char === "\\" && next) index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth < 0) throw new Error("Unbalanced SQL parentheses");
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index + 1 < sql.length && /[A-Za-z0-9_$]/.test(sql[index + 1])) index += 1;
      words.push({ value: sql.slice(start, index + 1).toUpperCase(), start, depth });
    }
  }
  if (quote || blockComment || depth !== 0) throw new Error("Incomplete SQL");
  return words;
}

function formatSql(rawSql: string): string {
  const words = topLevelWords(rawSql);
  const breaks = new Set<number>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.depth !== 0 || word.start === 0) continue;
    const next = words[index + 1];
    if (SINGLE_CLAUSES.has(word.value)) breaks.add(word.start);
    else if ((word.value === "GROUP" || word.value === "ORDER") && next?.depth === 0 && next.value === "BY") {
      breaks.add(word.start);
    } else if (word.value === "JOIN") {
      const previous = words[index - 1];
      breaks.add(previous?.depth === 0 && JOIN_MODIFIERS.has(previous.value) ? previous.start : word.start);
    }
  }
  if (!breaks.size) return rawSql;

  let formatted = rawSql;
  for (const position of [...breaks].sort((a, b) => b - a)) {
    let whitespaceStart = position;
    while (whitespaceStart > 0 && /[ \t]/.test(formatted[whitespaceStart - 1])) whitespaceStart -= 1;
    if (formatted[whitespaceStart - 1] === "\n" || formatted[whitespaceStart - 1] === "\r") continue;
    formatted = `${formatted.slice(0, whitespaceStart)}\n${formatted.slice(position)}`;
  }
  return formatted;
}

/** On formatter failure, show raw SQL as-is without modifying original text. */
export function formatSqlForDisplay(rawSql: string): string {
  try {
    return formatSql(rawSql);
  } catch {
    return rawSql;
  }
}
