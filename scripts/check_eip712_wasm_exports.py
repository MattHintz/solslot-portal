#!/usr/bin/env python3
"""Verify the vendored Chia WASM glue exposes Solslot EIP-712 helpers."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "src" / "assets" / "chia_wasm" / "chia_wallet_sdk_wasm_bg.js"
DTS_PATH = ROOT / "src" / "assets" / "chia_wasm" / "chia_wallet_sdk_wasm.d.ts"

REQUIRED_EXPORTS = (
    "eip712TypeHash",
    "eip712DomainSeparator",
    "eip712HashToSign",
    "eip712MemberInnerPuzzleHash",
    "eip712MemberHash",
)


def _missing_exports(path: Path, pattern: str) -> list[str]:
    if not path.exists():
        return [f"{path} is missing"]
    text = path.read_text(encoding="utf-8")
    missing: list[str] = []
    for name in REQUIRED_EXPORTS:
        if re.search(pattern.format(name=re.escape(name)), text) is None:
            missing.append(name)
    return missing


def main() -> int:
    js_missing = _missing_exports(JS_PATH, r"export\s+function\s+{name}\s*\(")
    dts_missing = _missing_exports(DTS_PATH, r"export\s+function\s+{name}\s*\(")

    failures: list[str] = []
    if js_missing:
        failures.append(f"{JS_PATH}: missing {', '.join(js_missing)}")
    if dts_missing:
        failures.append(f"{DTS_PATH}: missing {', '.join(dts_missing)}")

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1

    print("EIP-712 WASM exports verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
