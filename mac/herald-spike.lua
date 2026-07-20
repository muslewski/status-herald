-- Phase-0 spike. Paste into the Hammerspoon Console (or require from init.lua),
-- then switch Ghostty tabs and watch the console.
local wf = hs.window.filter.new(false):setAppFilter("Ghostty", {})
wf:subscribe(hs.window.filter.windowTitleChanged, function(w)
  print("TITLE ->", w and w:title())
end)
wf:subscribe(hs.window.filter.windowFocused, function(w)
  print("FOCUS ->", w and w:title())
end)
print("herald spike armed — switch Ghostty tabs; distinct TITLE lines = PASS")
