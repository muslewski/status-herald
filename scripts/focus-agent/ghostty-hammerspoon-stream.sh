#!/usr/bin/env bash
# Event-driven focus adapter: stream the Mac's Ghostty focus events (emitted by
# the Hammerspoon herald-focus emitter) over ssh and drive `herald curtain
# focus`. Config-driven (herald config). Replaces the poll adapter's per-tick
# osascript with a single long-lived `tail -n0 -F` of the emitter's event file.
set -u
ONCE=0
while [ $# -gt 0 ]; do case "$1" in
  --once) ONCE=1;;
  *) echo "usage: $0 [--once]" >&2; exit 2;; esac; shift; done

cfg() { herald config 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).curtain.focus;process.stdout.write(String(process.argv[1].split(".").reduce((o,k)=>o?.[k],c)??""))}catch{}})' "$1"; }

HOST="$(cfg ssh.host)";            HOST="${HOST:-mac-music}"
CTMO="$(cfg ssh.connectTimeout)";  CTMO="${CTMO:-4}"
APP="$(cfg terminalApp)";          APP="${APP:-ghostty}"
EVENTFILE="$(cfg eventFile)";      EVENTFILE="${EVENTFILE:-\$HOME/.local/state/status-herald/focus-events}"
HB="$(cfg heartbeatSec)";          HB="${HB:-20}"
RTMO=$(( 2 * HB + 5 ))

SSH=(ssh -o ConnectTimeout="$CTMO" -o BatchMode=yes
     -o ServerAliveInterval=15 -o ServerAliveCountMax=3
     -o ControlMaster=auto -o ControlPath=/tmp/cm-shcurtain-%r@%h:%p -o ControlPersist=30s "$HOST")

# One-shot sync read of the current frontmost title -- identical to the poll
# adapter's read, so state is correct immediately and after every restart/gap.
read_title() {
  "${SSH[@]}" "osascript -e 'tell application \"System Events\"
    set fp to first process whose frontmost is true
    if name of fp is \"$APP\" then
      try
        return title of front window of fp
      on error
        return \"\"
      end try
    else
      return \"\"
    end if
  end tell'" 2>/dev/null
}

if [ "$ONCE" = 1 ]; then read_title; echo; exit 0; fi

# Initial sync before subscribing to the stream.
herald curtain focus "$(read_title)" 2>/dev/null

# Stream the emitter's event file. Real line -> focus. Heartbeat lines
# (__hb__ ...) only keep the stream warm and are skipped. `read -t` fires when
# nothing (not even a heartbeat) arrives within 2*heartbeatSec+5s -> the emitter
# is dead -> fall through and exit nonzero so systemd restarts + re-syncs.
# EXPANSION: $EVENTFILE is a variable value ($HOME/...); bash does not re-expand
# it locally, so the remote shell expands $HOME inside the double quotes.
"${SSH[@]}" "tail -n0 -F \"$EVENTFILE\"" 2>/dev/null | while IFS= read -r -t "$RTMO" line; do
  case "$line" in
    __hb__*) continue ;;
  esac
  herald curtain focus "$line" 2>/dev/null
done

# Stream ended or read timed out. Exit nonzero for systemd Restart=on-failure.
# Do NOT reveal-all here: a transient blip must hold last state (the resync on
# restart corrects it); the service's ExecStopPost owns reveal-all on a real stop.
exit 1
