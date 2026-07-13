#!/usr/bin/env bash
# THROWAWAY SPIKE. Proves: swap-pane preserves a live alt-screen TUI and
# focus-events fire through Ghostty+SSH+mouse. Run from Manjaro; attach from
# the Mac Ghostty via: ssh manjaro -t 'tmux attach -t spike'
set -euo pipefail
tmux kill-session -t spike 2>/dev/null || true
tmux new-session -d -s spike -n grid 'claude'      # slot 0 = real Claude
tmux split-window -h -t spike:grid 'htop || top'   # slot 1 = any TUI
tmux select-layout -t spike:grid even-horizontal
tmux new-window -d -n _holding -t spike: 'printf "\033[2J\033[H CURTAIN A "; sleep 100000'
tmux split-window -h -t spike:_holding 'printf "\033[2J\033[H CURTAIN B "; sleep 100000'
tmux select-layout -t spike:_holding even-horizontal
tmux set -g mouse on
tmux set -g focus-events on
tmux set-hook -g pane-focus-in  'run-shell "tmux display-message \"focus-in #{pane_id}\""'
tmux set-hook -g pane-focus-out 'run-shell "tmux display-message \"focus-out #{pane_id}\""'
echo "Attach from Mac: ssh manjaro -t 'tmux attach -t spike'"
echo "Then: click panes (watch focus-in/out messages), and run:"
echo "  tmux swap-pane -s <claude-pane> -t <curtain-pane>   # cover"
echo "  tmux swap-pane -s <curtain-pane> -t <claude-pane>   # reveal"
echo "List pane ids: tmux list-panes -a -F '#{window_name} #{pane_id} #{pane_current_command}'"
