local params = require('fxpanels.params')

-- RM_Gate - simple 1:1-inspired layout from Web UI.

local panel = {}

panel.meta = { win_w = 480, win_h = 520, scale_mult = 1.0 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function knob(ctx, track, fx, ui, scale, label, idx)
  if not idx then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, '##rm_gate_' .. label, v, scale, 54, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

local function vslider(ctx, track, fx, ui, scale, label, idx, height)
  if not idx then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.vslider(ctx, '##rm_gate_' .. label, v, scale, height or 240, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold', 'thresh' }, default = 0 },
    attack = { patterns = { 'attack' }, default = 1 },
    release = { patterns = { 'release' }, default = 2 },
    range = { patterns = { 'range' }, default = 3 },
    in_peak = { patterns = { 'telemetry : in peak', 'in peak', 'input peak' } },
    gate_close = { patterns = { 'gate closure', 'closure' } },
  }, cache, 'rm_gate')

  reaper.ImGui_Text(ctx, 'Gate')
  reaper.ImGui_Separator(ctx)

  local meter_h = 220 * scale
  if map.threshold ~= nil then
    vslider(ctx, track, fx, ui, scale, 'Threshold', map.threshold, meter_h)
  end

  if map.in_peak ~= nil then
    reaper.ImGui_SameLine(ctx, 0, 18 * scale)
    local peak = clamp01(params.get_norm(track, fx, map.in_peak))
    ui.meter_v(ctx, peak, scale, meter_h)
  end

  if map.gate_close ~= nil then
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
    local close = clamp01(params.get_norm(track, fx, map.gate_close))
    ui.meter_v(ctx, close, scale, meter_h)
  end

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)

  knob(ctx, track, fx, ui, scale, 'Attack', map.attack)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  knob(ctx, track, fx, ui, scale, 'Release', map.release)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  knob(ctx, track, fx, ui, scale, 'Range', map.range)
end

return panel
