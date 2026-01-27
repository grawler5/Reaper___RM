local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 860, win_h = 520, scale_mult = 1.5 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function knob(ctx, track, fx, ui, scale, label, idx)
  if idx == nil then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, '##rm_air_' .. label, v, scale, 64, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    mid = { patterns = { 'mid air' } },
    high = { patterns = { 'high air' } },
    trim = { patterns = { 'trim' } },
  }, cache, 'rm_air')

  reaper.ImGui_Text(ctx, 'RM Air')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Mid', map.mid)
  reaper.ImGui_SameLine(ctx, 0, 16 * scale)
  knob(ctx, track, fx, ui, scale, 'High', map.high)
  reaper.ImGui_SameLine(ctx, 0, 16 * scale)
  knob(ctx, track, fx, ui, scale, 'Trim', map.trim)
end

return panel
