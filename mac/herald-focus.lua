-- status-herald event-driven focus emitter (Hammerspoon).
-- Promotes mac/herald-spike.lua into the production emitter. Fires the instant
-- a Ghostty window/tab is focused or its title changes, appends the raw title
-- to EVENT_FILE, and appends "" when a non-Ghostty app takes focus. A Manjaro
-- adapter streams EVENT_FILE over ssh (tail -n0 -F) into `herald curtain focus`.
--
-- Install: copy to ~/.hammerspoon/herald-focus.lua and add this line to
-- ~/.hammerspoon/init.lua:
--     dofile(hs.configdir .. "/herald-focus.lua")
-- Then reload Hammerspoon (hs.reload() in the console, or the menubar item).
--
-- The constants below MUST match curtain.focus on the box: EVENT_FILE is
-- curtain.focus.eventFile with $HOME expanded to the Mac's home; APP_NAME is
-- curtain.focus.terminalApp (capitalized as the macOS app name); HEARTBEAT_SEC
-- is curtain.focus.heartbeatSec.

local APP_NAME      = "Ghostty"
local EVENT_FILE    = os.getenv("HOME") .. "/.local/state/status-herald/focus-events"
local HEARTBEAT_SEC = 20
local MAX_BYTES     = 64 * 1024 -- truncate the event file once it grows past this

-- mkdir -p the parent dir (ignore errors if it already exists).
hs.execute("mkdir -p '" .. EVENT_FILE:match("(.*)/[^/]*$") .. "'")

local last = nil -- dedup: only write when the emitted value changes

local function truncateIfLarge()
  local f = io.open(EVENT_FILE, "r")
  if not f then return end
  local size = f:seek("end")
  f:close()
  if size and size > MAX_BYTES then
    local w = io.open(EVENT_FILE, "w")
    if w then w:close() end
  end
end

local function append(line)
  local f = io.open(EVENT_FILE, "a")
  if not f then return end
  f:write(line .. "\n")
  f:close()
end

-- Emit a focus title (deduped). nil/"" means "no Ghostty window is frontmost".
local function emit(title)
  title = title or ""
  if title == last then return end
  last = title
  truncateIfLarge()
  append(title)
end

-- Ghostty window focus + title changes -> emit that window's title. Both are
-- needed: switching between Ghostty windows fires windowFocused; switching
-- tabs inside one window fires only windowTitleChanged (the window's title
-- changes to the active tab).
local wf = hs.window.filter.new(false):setAppFilter(APP_NAME, {})
wf:subscribe(hs.window.filter.windowFocused, function(w)
  emit(w and w:title() or "")
end)
wf:subscribe(hs.window.filter.windowTitleChanged, function(w)
  emit(w and w:title() or "")
end)

-- App activation: non-Ghostty -> "" (box covers all); Ghostty -> its focused
-- window's title (covers switching back to Ghostty from another app).
local appWatcher = hs.application.watcher.new(function(name, event, app)
  if event == hs.application.watcher.activated then
    if name == APP_NAME then
      local w = app and app:focusedWindow()
      emit(w and w:title() or "")
    else
      emit("")
    end
  end
end)
appWatcher:start()

-- Heartbeat: proves the emitter is alive so the reader's read-timeout is tripped
-- only by a *dead* emitter, not an idle one. Not a focus event -> the reader
-- skips lines beginning with "__hb__".
local heartbeat = hs.timer.doEvery(HEARTBEAT_SEC, function()
  append("__hb__ " .. os.time())
end)

-- Keep references alive past this chunk's scope (Hammerspoon GCs otherwise).
_G.heraldFocus = { wf = wf, appWatcher = appWatcher, heartbeat = heartbeat }

-- Emit current state once at load so the box is correct immediately (and after
-- every hs.reload()).
do
  local app = hs.application.frontmostApplication()
  if app and app:name() == APP_NAME then
    local w = app:focusedWindow()
    emit(w and w:title() or "")
  else
    emit("")
  end
end

print("herald-focus emitter armed -> " .. EVENT_FILE)
