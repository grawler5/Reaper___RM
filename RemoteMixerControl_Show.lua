-- RemoteMixerControl_Show.lua
-- Safe launcher/focus script for RemoteMixerControl.lua
-- If the main UI isn't running, this will start it; otherwise it will just bring it to front.

local SCRIPT_NS = "ReaperRM"

local function get_script_dir()
  local src = debug.getinfo(1, "S").source or ""
  if src:sub(1,1) == "@" then src = src:sub(2) end
  -- dirname, supports / and \
  local dir = src:match([[^(.*)[/\\][^/\\]-$]])
  if dir and #dir > 0 then return dir end
  return reaper.GetResourcePath()
end

local function join_path(a, b)
  local sep = package.config:sub(1,1)
  if a:sub(-1) == "/" or a:sub(-1) == "\\" then
    return a .. b
  end
  return a .. sep .. b
end

-- Heartbeat key written by RemoteMixerControl.lua while running
local alive_val = reaper.GetExtState(SCRIPT_NS, "ControlUIAlive")
local alive_ts = tonumber(alive_val) or 0
local now = reaper.time_precise()

-- Consider UI alive if heartbeat updated within last 1.5s
local is_alive = (now - alive_ts) < 1.5

-- Ask UI to show/focus
reaper.SetExtState(SCRIPT_NS, "ControlUIVisible", "1", false)
reaper.SetExtState(SCRIPT_NS, "ControlUIFocus", "1", false)

if not is_alive then
  local dir = get_script_dir()
  local main_path = join_path(dir, "RemoteMixerControl.lua")
  local ok, err = pcall(dofile, main_path)
  if not ok then
    reaper.ShowMessageBox("Failed to start RemoteMixerControl.lua:\n" .. tostring(err), "ReaperRM", 0)
  end
end
