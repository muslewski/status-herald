#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card from THIS session's
# @herald_* options. Any keypress reveals the session (fail-open). Never exits.
set -u
sess=$(tmux display -p '#{session_name}' 2>/dev/null)
[ -n "$sess" ] || exit 0
printf '\033[?25l'
tick=0
while :; do
  # One tmux call for every option this repaint needs, instead of seven. At
  # forge's 2 fps across a fleet of sessions the per-option `show -v` calls
  # dominated the card's cost; `show-options` dumps them all in one shot and we
  # parse in-shell (no subprocess). Each line is `@herald_x value`; @herald_*
  # values are single tokens (enum/number/identifier), so `read -r k v` is safe.
  opts=$(tmux show-options -t "$sess" 2>/dev/null)
  unset O
  declare -A O
  while IFS=' ' read -r k v; do
    [ -n "$k" ] && O["$k"]="$v"
  done <<<"$opts"
  state=${O[@herald_state]:-idle}
  since=${O[@herald_since]:-0}
  subs=${O[@herald_bg_subagents]:-0}
  shells=${O[@herald_bg_shells]:-0}
  worked=${O[@herald_worked]:-0}
  theme=${O[@herald_theme]:-classic}
  frame_ms=${O[@herald_frame_ms]:-1000}
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --subagents "${subs:-0}" --shells "${shells:-0}" \
    --worked "${worked:-0}" \
    --theme "${theme:-classic}" --tick "$tick" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  tick=$((tick + 1))
  # Repaint interval: @herald_frame_ms (default 1000) → seconds for read -t.
  ms=${frame_ms:-1000}
  case "$ms" in
    "" | *[!0-9]*) secs=1 ;;
    *) secs=$(awk "BEGIN{printf \"%.3f\", $ms/1000}" 2>/dev/null || echo 1) ;;
  esac
  if read -rsn1 -t "$secs" 2>/dev/null; then
    herald curtain reveal "$sess" >/dev/null 2>&1 || true
  fi
done
