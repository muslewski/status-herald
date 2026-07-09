#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card once/second from
# THIS session's @herald_state. Any keypress reveals the session (fail-open, so
# a dead Mac agent can never trap you behind the card). Never exits.
set -u
sess=$(tmux display -p '#{session_name}' 2>/dev/null)
[ -n "$sess" ] || exit 0
printf '\033[?25l'
while :; do
  state=$(tmux show -t "$sess" -v @herald_state 2>/dev/null)
  since=$(tmux show -t "$sess" -v @herald_since 2>/dev/null)
  subs=$(tmux show -t "$sess" -v @herald_bg_subagents 2>/dev/null)
  shells=$(tmux show -t "$sess" -v @herald_bg_shells 2>/dev/null)
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --subagents "${subs:-0}" --shells "${shells:-0}" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  if read -rsn1 -t 1 2>/dev/null; then
    herald curtain reveal "$sess" >/dev/null 2>&1 || true
  fi
done
