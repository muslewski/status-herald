#!/usr/bin/env bash
# Compat wrapper for MouseDown1StatusRight binds that still call this path.
# Prefer: herald curtain status-menu <session>
set -euo pipefail
sess="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/herald"
if [[ ! -x "$BIN" ]]; then
  BIN="$(command -v herald 2>/dev/null || true)"
fi
if [[ -z "$BIN" ]]; then
  exit 0
fi
exec node "$BIN" curtain status-menu "$sess"
