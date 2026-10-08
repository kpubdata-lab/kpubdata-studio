/**
 * A cell drawn by what its column holds (#844).
 *
 * Every value used to be one truncated run of monospace text: a count read `1234567`
 * against the left edge, an address could not be followed, and a long text could only be
 * cut. `cellDisplay` says what the value is, from the column's logical type; this draws it:
 *
 * - a number against the right edge in tabular figures, its digits in threes. The
 *   separators are drawn, not written: the cell's text is still the text Builder sent,
 *   so a number copied out of a table is a number, and an id that happens to be an
 *   integer is not handed on with commas in it;
 * - a date in one line, as `YYYY-MM-DD HH:mm`;
 * - a web address as a link that opens elsewhere and passes nothing on;
 * - a long text cut to one line with a control that opens it in place.
 *
 * Nothing here converts a value: the digits shown are the digits sent (#484).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cellDisplay, type CellKind, type WireEncoding } from "@/shared/lib/cellValue";

/** Longer than this, a text gets the control that opens it. About what a cell shows. */
export const LONG_TEXT = 40;

/** The alignment a column of this kind takes, header included. */
export function cellAlignment(kind: CellKind): string {
  return kind === "number" ? "text-right tabular-nums" : "";
}

export interface TypedCellProps {
  encoding: WireEncoding | undefined;
  logicalType: string | undefined;
  /** `semantic.kind`, when Builder said what the column means. */
  semanticKind?: string;
  /** The column's name, for the controls a cell has: several cells on a page have one. */
  column: string;
  value: unknown;
}

export function TypedCell({ encoding, logicalType, semanticKind, column, value }: TypedCellProps) {
  const { t } = useTranslation();
  const display = cellDisplay(encoding, logicalType, value, semanticKind);
  if (display.kind === "missing") return <span className="text-muted-foreground">{display.text}</span>;
  if (display.kind === "link") {
    return (
      <a
        className="block max-w-72 truncate text-brand-text underline underline-offset-2"
        data-cell-kind="link"
        href={display.href}
        rel="noopener noreferrer"
        target="_blank"
        title={display.text}
      >
        {display.text}
        {/* It leaves the page: said to a screen reader, marked for the eye. */}
        <span aria-hidden="true"> ↗</span>
        <span className="sr-only"> {t("dataTable.opensNewTab")}</span>
      </a>
    );
  }
  if (display.kind === "number" && display.digits) {
    const { sign, groups, fraction } = display.digits;
    return (
      <span className="whitespace-nowrap tabular-nums" data-cell-kind="number">
        {sign}
        {groups.map((group, index) => (
          // The comma is generated content: seen, and in no text that is read or copied.
          <span className={index === 0 ? undefined : "before:content-[',']"} data-digit-group="" key={index}>
            {group}
          </span>
        ))}
        {fraction}
      </span>
    );
  }
  if (display.kind === "number" || display.kind === "date") {
    return (
      <span className="whitespace-nowrap tabular-nums" data-cell-kind={display.kind}>
        {display.text}
      </span>
    );
  }
  // Keyed by its text: a cell opened on one page is not found open on the next, where the
  // same row of the table holds another value.
  return <TextCell column={column} key={display.text} text={display.text} />;
}

function TextCell({ text, column }: { text: string; column: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (text.length <= LONG_TEXT) {
    // One line, as every cell was: wide characters would otherwise wrap a short text.
    return (
      <span className="block max-w-72 truncate" data-cell-kind="text" title={text}>
        {text}
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2" data-cell-kind="text" data-cell-long="">
      <span className={open ? "max-w-xl whitespace-pre-wrap break-words" : "block max-w-72 truncate"}>{text}</span>
      <button
        aria-expanded={open}
        aria-label={open ? t("dataTable.collapseColumn", { column }) : t("dataTable.expandColumn", { column })}
        className="shrink-0 rounded border border-border px-1.5 font-sans text-[11px] text-muted-foreground hover:bg-muted"
        onClick={() => setOpen((was) => !was)}
        type="button"
      >
        {open ? t("dataTable.collapse") : t("dataTable.expand")}
      </button>
    </span>
  );
}
