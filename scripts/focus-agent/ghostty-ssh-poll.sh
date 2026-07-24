#!/usr/bin/env bash
# Reference focus adapter: poll the Mac's frontmost terminal-tab title over ssh
# and drive `herald curtain focus`. Config-driven (herald config). The box
# normalizes the title (titleStripPrefixes), so this sends the raw title.
set -u
ONCE=0; SENTINEL=""; MAXSEC=0
while [ $# -gt 0 ]; do case "$1" in
  --once) ONCE=1;; --sentinel) SENTINEL="$2"; shift;; --max) MAXSEC="$2"; shift;;
  *) echo "usage: $0 [--once] [--sentinel FILE] [--max SEC]" >&2; exit 2;; esac; shift; done

cfg() { herald config 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).curtain.focus;process.stdout.write(String(process.argv[1].split(".").reduce((o,k)=>o?.[k],c)??""))}catch{}})' "$1"; }

HOST="$(cfg ssh.host)";           HOST="${HOST:-mac-music}"
CTMO="$(cfg ssh.connectTimeout)"; CTMO="${CTMO:-4}"
APP="$(cfg terminalApp)";         APP="${APP:-ghostty}"
POLLMS="$(cfg pollMs)";           POLLMS="${POLLMS:-350}"
POLL="$(awk "BEGIN{printf \"%.3f\", ${POLLMS}/1000}")"

SSH=(ssh -o ConnectTimeout="$CTMO" -o BatchMode=yes
     -o ControlMaster=auto -o ControlPath=/tmp/cm-shcurtain-%r@%h:%p -o ControlPersist=30s "$HOST")

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

# Empty titles mean "Ghostty not frontmost" → cover-all. But a single flaky
# osascript read also returns "" while Ghostty is still focused; acting on that
# yanks a curtain over the live pane the operator is looking at. Require a few
# consecutive empties (~3 × pollMs) before covering.
EMPTY_NEED=3
empty_streak=0
last="__init__"; start=$(date +%s)
while :; do
  [ -n "$SENTINEL" ] && [ ! -f "$SENTINEL" ] && break
  [ "$MAXSEC" -gt 0 ] && [ $(( $(date +%s) - start )) -ge "$MAXSEC" ] && break
  t="$(read_title)"
  if [ -z "$t" ]; then
    empty_streak=$((empty_streak + 1))
    if [ "$empty_streak" -ge "$EMPTY_NEED" ] && [ "$last" != "" ]; then
      herald curtain focus "" 2>/dev/null
      last=""
    fi
  else
    empty_streak=0
    if [ "$t" != "$last" ]; then
      herald curtain focus "$t" 2>/dev/null
      last="$t"
    fi
  fi
  sleep "$POLL"
done
herald curtain reveal-all 2>/dev/null
