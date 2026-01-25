-- Deprecated entry point.
-- FX panels are now started automatically by RemoteMixerControl.lua.

local EXT_SECTION = 'ReaperRM'
local function ext_get(k) return reaper.GetExtState(EXT_SECTION, k) end

-- If control is alive, we can still start panels for backwards compatibility.
local hb = tonumber(ext_get('ControlHB') or '')
local now = (reaper.time_precise and reaper.time_precise() or os.clock())
local alive = hb and (now - hb) < 2.0

if not alive then
  reaper.ShowMessageBox('FX panels are started by RemoteMixerControl.lua.\n\nRun "RemoteMixerControl.lua" action instead.', 'ReaperRM', 0)
  return
end

local script_path = debug.getinfo(1, 'S').source:sub(2)
local base = script_path:match('^(.+)/Scripts/ReaperRM/')
if base then
  base = base .. '/Scripts/ReaperRM/lua'
  package.path = base .. '/?.lua;' .. base .. '/?/init.lua;' .. package.path
end

local ok, mod = pcall(require, 'fxpanels.main')
if ok and type(mod) == 'table' and type(mod.run) == 'function' then
  mod.run()
end
