#!/usr/bin/env bash
# Runs inside a curtain pane. Repaints the card once/second from the peer
# (live) pane's @herald_state. Never exits; resilient to transient errors.
set -u
pane="${TMUX_PANE:-}"
[ -n "$pane" ] || exit 0
printf '\033[?25l'
while :; do
  peer=$(tmux show -p -t "$pane" -v @herald_peer 2>/dev/null)
  state=$(tmux show -p -t "$peer" -v @herald_state 2>/dev/null)
  since=$(tmux show -p -t "$peer" -v @herald_since 2>/dev/null)
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  sleep 1
done
