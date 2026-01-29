-- Render FX panels to PNGs for visual regression.
-- Run inside REAPER with ReaImGui + js_ReaScriptAPI installed.

local registry = require('fxpanels.registry')
local ui_main = require('fxpanels.main')

local function has_js_api()
  return reaper.JS_Window_Find ~= nil and reaper.JS_Window_ScreenShot ~= nil
end

local function warn(msg)
  reaper.ShowMessageBox(msg, 'ReaperRM Visual Harness', 0)
end

if not has_js_api() then
  warn('js_ReaScriptAPI not available. Install it to capture screenshots.')
  return
end

local sizes = {
  { w = 400, h = 300 },
  { w = 600, h = 400 },
  { w = 900, h = 600 },
}

local out_root = reaper.GetResourcePath() .. '/Scripts/ReaperRM/tests/visual/current'

local function ensure_dir(path)
  if reaper.RecursiveCreateDirectory then
    reaper.RecursiveCreateDirectory(path, 0)
  end
end

local function capture_window(title, path)
  local hwnd = reaper.JS_Window_Find(title, true)
  if not hwnd then
    return false
  end
  reaper.JS_Window_ScreenShot(hwnd, path)
  return true
end

-- TODO: Extend to programmatically open each FX panel in a dedicated window
-- and render via ui_main with a deterministic sizing. The current implementation
-- assumes panels are already open in separate windows.

local panels = registry.list_keys and registry.list_keys() or {}
if #panels == 0 then
  -- fallback to known keys
  panels = {
    'rm_saturator', 'rm_ns', 'rm_compressor2', 'rm_comp2', 'rm_compressor',
    'rm_eq2', 'rm_eq4', 'rm_preamp', 'rm_1175', 'rm_la1a', 'rm_gate',
    'rm_deesser', 'rm_limiter2', 'rm_kicker50hz', 'rm_delaymachine',
    'rm_vox', 'rm_eqt1a', 'rm_lexikan2', 'rm_air',
  }
end

for _, key in ipairs(panels) do
  for _, size in ipairs(sizes) do
    local out_dir = string.format('%s/%s', out_root, key)
    ensure_dir(out_dir)
    local filename = string.format('%s/%dx%d.png', out_dir, size.w, size.h)

    -- TODO: Implement deterministic render for panel key + size.
    -- For now, just capture the main panel window title if available.
    capture_window('ReaperRM FX Panels', filename)
  end
end
