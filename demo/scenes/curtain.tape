# Hero: stage-curtain shut → spark rain (DONE), end fully closed. Live on greenui-demo.
# No shell commands in any frame — setup + attach under Hide; Show only on stage.
Output ../assets/demo-curtain.gif
Output build/demo-curtain.txt
Set Width 1200
Set Height 640
Hide
# Fast typing so the background trigger's 1s sleep still lines up with Show.
Set TypingSpeed 1ms
Type "source ~/.bashrc"
Enter
Type "clear"
Enter
# Fire the draw sequence ~1s after attach (script sleeps 1s first).
Type "herald-demo-trigger.sh >/dev/null 2>&1 &"
Enter
Sleep 200ms
Type "tmux -L greenui-demo attach -t atlas"
Enter
# Attach lands on pre-covered atlas; wait for stage paint before capture.
Sleep 800ms
Show
# From trigger start ≈ 1.0s when Show begins → shut soon after.
# Shut (~0.6s) + WORKING hold → DONE spark rain → fully drawn closed ~1.5s.
# Hide before detach so the shell never returns on screen.
Sleep 4.5s
Hide
# Detach under Hide so the final visible frame stays the closed curtain.
Ctrl+B
Sleep 200ms
Type "d"
Sleep 300ms
