# Hero: stage-curtain shut → spark rain (DONE) → open, live on greenui-demo.
Output ../assets/demo-curtain.gif
Output build/demo-curtain.txt
Set Width 1200
Set Height 640
Hide
Type "export PS1='demo$ '; export PATH=\"$HOME/bin:$PATH\"; unset TMUX; clear"
Enter
# Fire the draw sequence ~1s after attach (script sleeps 1s first).
Type "$HOME/bin/herald-demo-trigger.sh >/dev/null 2>&1 &"
Enter
Sleep 300ms
Show
Type "tmux -L greenui-demo attach -t atlas"
Enter
# Full shut (~0.6s) + steady card + spark rain + open (~0.6s). Trim dead air.
Sleep 5s
# Detach cleanly (tmux prefix + d).
Ctrl+B
Sleep 200ms
Type "d"
Sleep 800ms
