local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 470, win_h = 560, scale_mult = 1.0 }

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
  local changed, nv = ui.knob_norm(ctx, '##rm_l2_' .. label, v, scale, 56, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold' } },
    output = { patterns = { 'output' } },
    release = { patterns = { 'release' } },
    maximizer = { patterns = { 'maximizer' } },
    in_peak = { patterns = { 'telemetry', 'in peak' } },
    out_peak = { patterns = { 'telemetry', 'out peak' } },
    gr = { patterns = { 'telemetry', 'atten', 'gr' } },
  }, cache, 'rm_limiter2')

  reaper.ImGui_Text(ctx, 'RM Limiter2')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Threshold', map.threshold)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Output', map.output)

  reaper.ImGui_Dummy(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Release', map.release)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Maximizer', map.maximizer)

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

return panel
