#!/usr/bin/env bash
# Focus-adapter dispatcher. Reads curtain.focus.source from `herald config` and
# execs the matching reference adapter. The systemd unit's ExecStart points
# here, so switching adapters is a config edit + `systemctl --user restart`,
# never a unit-file edit. `--print` reports the choice without exec (test seam).
set -u

# Adapters live next to this script by default; overridable so the installed
# copy under ~/.local/share/status-herald resolves too.
DIR="${HERALD_FOCUS_AGENT_DIR:-$(cd "$(dirname "$0")" && pwd)}"

SOURCE="$(herald config 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).curtain.focus.source||""))}catch{}})')"
SOURCE="${SOURCE:-ssh-osascript}"

case "$SOURCE" in
  ghostty-hammerspoon) ADAPTER="$DIR/ghostty-hammerspoon-stream.sh" ;;
  ssh-osascript | *)   ADAPTER="$DIR/ghostty-ssh-poll.sh" ;;
esac

if [ "${1:-}" = "--print" ]; then
  echo "$SOURCE -> $ADAPTER"
  exit 0
fi

exec bash "$ADAPTER" "$@"
