#!/usr/bin/env python3
"""Ratchet gate for Korean comments in TS/TSX (studio#427).

The debt is not yet at zero (419 comments remain, all in test-heavy files
where string data and comments interleave). Until it reaches zero this gate
freezes the per-file baseline and fails ONLY when a count grows or a file
absent from the baseline has any Korean comment. Translating comments down
always passes — after a translation lands, regenerate the baseline and
commit the lower numbers.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / "scripts" / "korean_comment_baseline.json"


def current_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    out = subprocess.run(
        ["python3", str(REPO / "scripts" / "check_korean_ts_comments.py"), "src", "e2e"],
        capture_output=True,
        text=True,
        cwd=REPO,
    ).stdout
    for line in out.splitlines():
        if re.match(r"^(src|e2e)/[^:]+:\d+:", line):
            f = line.split(":", 1)[0]
            counts[f] = counts.get(f, 0) + 1
    return counts


def main() -> int:
    baseline: dict[str, int] = json.loads(BASELINE.read_text(encoding="utf-8"))
    current = current_counts()
    violations = []
    for f, n in sorted(current.items()):
        limit = baseline.get(f, 0)
        if n > limit:
            violations.append(f"{f}: {n} > baseline {limit}")
    if violations:
        print("Korean comment ratchet FAILED — counts grew:")
        for v in violations:
            print(f"  {v}")
        print("Translate the new comments to English, or lower them to baseline.")
        return 1
    total = sum(current.values())
    base_total = sum(baseline.values())
    print(f"ratchet OK: {total} comments (baseline {base_total})")
    if total < base_total:
        print("debt decreased — regenerate scripts/korean_comment_baseline.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
