/**
 * Minimal safe Markdown parser/renderer (#258).
 *
 * Kubi responses and user input are untrusted (#258 §13). The repo has no
 * markdown/HTML-sanitize library (package.json checked), and the issue
 * guidance says to reuse existing code before adding large dependencies —
 * so a tiny subset parser (part of GFM) is hand-rolled instead; unsupported
 * syntax just remains as escaped text.
 *
 * Core safety invariant: never generate arbitrary HTML such as
 * `<script>`/`javascript:`/on* event attributes.
 * - The React renderer (`renderMarkdownToReact`) never uses
 *   `dangerouslySetInnerHTML`; it only creates React elements (React
 *   auto-escapes text nodes).
 * - The HTML-string renderer (`renderMarkdownToHtml`, for export) never
 *   interpolates raw text — only `escapeHtml`-passed text goes between tags
 *   we produced.
 * - Links allow only `http(s)://` hrefs, and new-window links force
 *   `rel="noopener noreferrer"` (#258 §13).
 */
import { Fragment, createElement, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/** Splits text into blank-line-separated blocks and classifies each; unknown shapes become paragraphs. */
function parseBlocks(markdown: string): Block[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const chunks = normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  const blocks: Block[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n");

    if (/^-{3,}$/.test(chunk.trim())) {
      blocks.push({ type: "hr" });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (headingMatch && lines.length === 1) {
      blocks.push({ type: "heading", level: headingMatch[1].length as 1 | 2 | 3, text: headingMatch[2].trim() });
      continue;
    }

    if (lines.length >= 2 && lines[0].includes("|") && isTableSeparatorRow(lines[1])) {
      const header = splitTableRow(lines[0]);
      const rows = lines.slice(2).filter((line) => line.includes("|")).map(splitTableRow);
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (lines.every((line) => /^\s*([-*])\s+/.test(line))) {
      blocks.push({ type: "list", ordered: false, items: lines.map((line) => line.replace(/^\s*[-*]\s+/, "")) });
      continue;
    }

    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      blocks.push({ type: "list", ordered: true, items: lines.map((line) => line.replace(/^\s*\d+\.\s+/, "")) });
      continue;
    }

    if (lines.every((line) => /^>\s?/.test(line))) {
      blocks.push({ type: "blockquote", text: lines.map((line) => line.replace(/^>\s?/, "")).join(" ") });
      continue;
    }

    blocks.push({ type: "paragraph", text: lines.join(" ") });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline tokens (bold/italic/code/link)
// ---------------------------------------------------------------------------

type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

/** Only hrefs starting with http:// or https:// count as safe; javascript: and friends are all rejected. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

const INLINE_PATTERN = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\((\S+?)\)/g;

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });

    if (match[1] !== undefined) tokens.push({ type: "bold", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: "code", text: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: "italic", text: match[3] });
    else if (match[4] !== undefined) tokens.push({ type: "italic", text: match[4] });
    else if (match[5] !== undefined && match[6] !== undefined) {
      const href = match[6];
      if (isSafeHref(href)) tokens.push({ type: "link", text: match[5], href });
      else tokens.push({ type: "text", text: `${match[5]} (${href})` });
    }

    lastIndex = INLINE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", text: text.slice(lastIndex) });
  return tokens;
}

// ---------------------------------------------------------------------------
// React renderer — no dangerouslySetInnerHTML.
// ---------------------------------------------------------------------------

function renderInlineToReact(text: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text":
        return token.text;
      case "bold":
        return createElement("strong", { key }, token.text);
      case "italic":
        return createElement("em", { key }, token.text);
      case "code":
        return createElement("code", { key, className: "rounded bg-muted px-1 py-0.5 text-xs" }, token.text);
      case "link":
        return createElement(
          "a",
          { key, href: token.href, target: "_blank", rel: "noopener noreferrer", className: "underline" },
          token.text,
        );
    }
  });
}

/** Renders Markdown source into a safe React element tree (preview/editor display). */
export function renderMarkdownToReact(markdown: string): ReactNode {
  const blocks = parseBlocks(markdown);
  if (blocks.length === 0) return null;

  return createElement(
    Fragment,
    null,
    blocks.map((block, index) => {
      const key = `block-${index}`;
      switch (block.type) {
        case "heading": {
          const tag = `h${block.level + 2}`; // Relative size within the document — h1 is reserved for the Report title.
          return createElement(tag, { key, className: "font-semibold" }, renderInlineToReact(block.text, key));
        }
        case "paragraph":
          return createElement("p", { key, className: "leading-relaxed" }, renderInlineToReact(block.text, key));
        case "list":
          return createElement(
            block.ordered ? "ol" : "ul",
            { key, className: block.ordered ? "list-decimal pl-5" : "list-disc pl-5" },
            block.items.map((item, itemIndex) =>
              createElement("li", { key: `${key}-${itemIndex}` }, renderInlineToReact(item, `${key}-${itemIndex}`)),
            ),
          );
        case "blockquote":
          return createElement(
            "blockquote",
            { key, className: "border-l-2 border-border pl-3 italic text-muted-foreground" },
            renderInlineToReact(block.text, key),
          );
        case "table":
          return createElement(
            "div",
            { key, className: "overflow-x-auto" },
            createElement(
              "table",
              { className: "w-full text-left text-sm" },
              createElement(
                "thead",
                null,
                createElement(
                  "tr",
                  null,
                  block.header.map((cell, cellIndex) =>
                    createElement("th", { key: cellIndex, className: "border-b border-border px-2 py-1 font-semibold" }, cell),
                  ),
                ),
              ),
              createElement(
                "tbody",
                null,
                block.rows.map((row, rowIndex) =>
                  createElement(
                    "tr",
                    { key: rowIndex },
                    row.map((cell, cellIndex) =>
                      createElement("td", { key: cellIndex, className: "border-b border-border px-2 py-1" }, cell),
                    ),
                  ),
                ),
              ),
            ),
          );
        case "hr":
          return createElement("hr", { key, className: "border-border" });
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// HTML-string renderer — export/print. Raw text enters tags only after escapeHtml.
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineToHtml(text: string): string {
  return tokenizeInline(text)
    .map((token) => {
      switch (token.type) {
        case "text":
          return escapeHtml(token.text);
        case "bold":
          return `<strong>${escapeHtml(token.text)}</strong>`;
        case "italic":
          return `<em>${escapeHtml(token.text)}</em>`;
        case "code":
          return `<code>${escapeHtml(token.text)}</code>`;
        case "link":
          // href is already http(s)-only via isSafeHref; the attribute value itself is escaped too.
          return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.text)}</a>`;
      }
    })
    .join("");
}

/** Renders Markdown source into a safe HTML string (export/print). */
export function renderMarkdownToHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${block.level + 2}>${renderInlineToHtml(block.text)}</h${block.level + 2}>`;
        case "paragraph":
          return `<p>${renderInlineToHtml(block.text)}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items.map((item) => `<li>${renderInlineToHtml(item)}</li>`).join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "blockquote":
          return `<blockquote>${renderInlineToHtml(block.text)}</blockquote>`;
        case "table": {
          const header = block.header.map((cell) => `<th>${renderInlineToHtml(cell)}</th>`).join("");
          const rows = block.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineToHtml(cell)}</td>`).join("")}</tr>`)
            .join("");
          return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
        }
        case "hr":
          return "<hr />";
      }
    })
    .join("\n");
}
