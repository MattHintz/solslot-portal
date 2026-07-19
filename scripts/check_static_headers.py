#!/usr/bin/env python3
"""Verify static-host security headers committed with the portal build."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HEADERS_PATH = ROOT / "public" / "_headers"


def _parse_headers(text: str) -> dict[str, dict[str, str]]:
    blocks: dict[str, dict[str, str]] = {}
    current_path: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not raw_line[:1].isspace():
            current_path = stripped
            blocks.setdefault(current_path, {})
            continue
        if current_path is None or ":" not in stripped:
            continue
        name, value = stripped.split(":", 1)
        blocks[current_path][name.lower()] = value.strip()
    return blocks


def main() -> int:
    if not HEADERS_PATH.exists():
        print(f"missing static host headers file: {HEADERS_PATH}", file=sys.stderr)
        return 1

    headers_by_path = _parse_headers(HEADERS_PATH.read_text(encoding="utf-8"))
    headers = headers_by_path.get("/*")
    if headers is None:
        print("public/_headers must define a /* block", file=sys.stderr)
        return 1

    failures: list[str] = []
    csp = headers.get("content-security-policy", "")
    if "frame-ancestors 'none'" not in csp:
        failures.append("Content-Security-Policy must include frame-ancestors 'none'")
    if headers.get("x-frame-options", "").upper() != "DENY":
        failures.append("X-Frame-Options must be DENY")
    if headers.get("x-content-type-options", "").lower() != "nosniff":
        failures.append("X-Content-Type-Options must be nosniff")
    if "max-age=31536000" not in headers.get("strict-transport-security", ""):
        failures.append("Strict-Transport-Security must include max-age=31536000")

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1

    print("static host security headers verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
