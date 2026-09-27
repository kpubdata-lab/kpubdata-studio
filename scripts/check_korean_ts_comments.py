#!/usr/bin/env python3
"""Fail when a TS/TSX comment still contains Korean text (studio#427).

Counts Hangul inside `//` line comments and `/* */` block comments only.
String literals ('...', "...", `...`) are stripped first — including
template-literal `${...}` expressions, whose inner strings and braces are
tracked — so Korean UI labels never count. JSDoc blocks are comments and
are checked.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HANGUL = re.compile(r"[가-힣]")


def findings(path: Path) -> list[tuple[int, str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    found: list[tuple[int, str]] = []
    line = 1
    i = 0
    n = len(text)

    def eat_string(quote: str) -> None:
        """Consume a quoted string; handles escapes and template nesting."""
        nonlocal i, line
        while i < n:
            ch = text[i]
            if ch == "\\":
                i += 2
                continue
            if ch == "\n":
                line += 1
            if quote == "`" and ch == "$" and i + 1 < n and text[i + 1] == "{":
                i += 2
                eat_template_expression()
                continue
            if ch == quote:
                i += 1
                return
            i += 1

    def eat_template_expression() -> None:
        """Consume a ${...} expression inside a template literal."""
        nonlocal i, line
        depth = 0
        while i < n:
            ch = text[i]
            if ch in "'\"":
                eat_string(ch)
                continue
            if ch == "`":
                eat_string("`")
                continue
            if ch == "/" and i + 1 < n and text[i + 1] == "/":
                while i < n and text[i] != "\n":
                    i += 1
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    i += 1
                    return
            elif ch == "\n":
                line += 1
            i += 1

    comment_start: int | None = None
    comment_text: list[str] = []
    block = {"depth": 0}

    def flush_comment() -> None:
        nonlocal comment_start, comment_text
        if comment_start is not None:
            body = "".join(comment_text)
            if HANGUL.search(body):
                excerpt = body.strip().replace("\n", " ")[:80]
                found.append((comment_start, excerpt))
        comment_start = None
        comment_text = []

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "\n":
            line += 1
            if comment_start is not None and block["depth"] == 0:
                flush_comment()
            i += 1
            continue
        if comment_start is None:
            if ch in "'\"":
                eat_string(ch)
                continue
            if ch == "`":
                eat_string("`")
                continue
            if ch == "/" and nxt == "/":
                comment_start = line
                comment_text = []
                i += 2
                continue
            if ch == "/" and nxt == "*":
                comment_start = line
                comment_text = []
                block["depth"] = 1
                i += 2
                continue
            i += 1
        else:
            if block["depth"] > 0:
                if ch == "*" and nxt == "/":
                    block["depth"] -= 1
                    if block["depth"] == 0:
                        i += 2
                        comment_text.append(" ")
                        flush_comment()
                        continue
                comment_text.append(ch)
                i += 1
            else:
                comment_text.append(ch)
                i += 1
    flush_comment()
    return found


def scan(path: Path) -> list[tuple[int, str]]:
    return findings(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("roots", nargs="*", default=["src", "e2e"])
    args = parser.parse_args()

    total = 0
    for root in args.roots:
        base = Path(root)
        files = [base] if base.is_file() else sorted(
            p for pattern in ("*.ts", "*.tsx") for p in base.rglob(pattern)
        )
        for path in files:
            for lineno, excerpt in scan(path):
                total += 1
                print(f"{path}:{lineno}: {excerpt}")
    if total == 0:
        print(f"checked roots {args.roots}: no Korean comments")
        return 0
    print(f"{total} Korean comment(s) remain.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
