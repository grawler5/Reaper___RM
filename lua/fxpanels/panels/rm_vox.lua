local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 460, win_h = 460, scale_mult = 1.0 }

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
  local changed, nv = ui.knob_norm(ctx, '##rm_vox_' .. label, v, scale, 56, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    gate = { patterns = { 'gate' } },
    comp = { patterns = { 'comp' } },
    gain = { patterns = { 'gain' } },
    in_peak = { patterns = { 'telemetry', 'in peak' } },
    gr = { patterns = { 'telemetry', 'gr' } },
    out_peak = { patterns = { 'telemetry', 'out peak' } },
  }, cache, 'rm_vox')

  reaper.ImGui_Text(ctx, 'RM Vox')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Gate', map.gate)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Comp', map.comp)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Gain', map.gain)

  reaper.ImGui_Dummy(ctx, 0, 12 * scale)
  if map.in_peak ~= nil then
    ui.meter_v(ctx, clamp01(params.get_norm(track, fx, map.in_peak)), scale, 180)
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  end
  if map.gr ~= nil then
    ui.meter_v(ctx, clamp01(params.get_norm(track, fx, map.gr)), scale, 180)
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  end
  if map.out_peak ~= nil then
    ui.meter_v(ctx, clamp01(params.get_norm(track, fx, map.out_peak)), scale, 180)
  end
end

function panel.clear_cache()
  for k in pairs(cache) do
    cache[k] = nil
  end
end

return panel
