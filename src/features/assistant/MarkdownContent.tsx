import { Fragment, type ReactNode } from "react";

// A same-origin path is `/` not followed by `/` or `\`: `//host` is another origin (#772),
// and browsers read `/\host` the same way.
const SAFE_LINK = /^(https?:\/\/|\/(?![/\\])|\.\/|\.\.\/|#)/i;

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("**")) parts.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) parts.push(<em key={index}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("`")) parts.push(<code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">{token.slice(1, -1)}</code>);
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link?.[2] ?? "";
      parts.push(SAFE_LINK.test(href) ? <a key={index} href={href} rel="noopener noreferrer" className="underline">{link?.[1]}</a> : <span key={index}>{link?.[1]}</span>);
    }
    last = index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A minimal Markdown renderer that does not parse raw HTML. LLM strings are always rendered as React text nodes only. */
export function MarkdownContent({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      nodes.push(<pre key={`code-${i}`} className="overflow-x-auto rounded-lg bg-muted/70 p-3 font-mono text-xs"><code data-language={language || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const split = (value: string) => value.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
      const headers = split(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) rows.push(split(lines[i++]));
      nodes.push(<div key={`table-${i}`} className="overflow-x-auto"><table className="min-w-full border-collapse text-left text-xs"><thead><tr>{headers.map((cell, index) => <th key={index} className="border border-border bg-muted/50 px-2 py-1.5">{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex} className="border border-border px-2 py-1.5">{inline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const unordered = line.match(/^[-*] (.+)$/);
    const ordered = line.match(/^\d+\. (.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(orderedList ? /^\d+\. (.+)$/ : /^[-*] (.+)$/);
        if (!item) break;
        items.push(item[1]); i += 1;
      }
      const List = orderedList ? "ol" : "ul";
      nodes.push(<List key={`list-${i}`} className={`${orderedList ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</List>);
      continue;
    }
    if (line.startsWith("> ")) { nodes.push(<blockquote key={`quote-${i}`} className="border-l-2 border-border pl-3 text-muted-foreground">{inline(line.slice(2))}</blockquote>); i += 1; continue; }
    if (!line.trim()) { i += 1; continue; }
    const paragraph: string[] = [line]; i += 1;
    while (i < lines.length && lines[i].trim() && !/^(```|[-*] |\d+\. |> )/.test(lines[i])) paragraph.push(lines[i++]);
    nodes.push(<p key={`p-${i}`} className="break-words leading-6">{paragraph.map((value, index) => <Fragment key={index}>{index ? <br /> : null}{inline(value)}</Fragment>)}</p>);
  }
  return <div className="space-y-3 text-foreground">{nodes}</div>;
}
