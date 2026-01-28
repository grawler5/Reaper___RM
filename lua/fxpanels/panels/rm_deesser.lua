local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 680, win_h = 420, scale_mult = 1.0 }

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
  local changed, nv = ui.knob_norm(ctx, '##rm_deesser_' .. label, v, scale, 54, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

local function meter(ctx, track, fx, ui, scale, idx)
  if idx == nil then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  ui.meter_v(ctx, v, scale, 180)
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold', 'thr' } },
    freq = { patterns = { 'frequency', 'freq' } },
    range = { patterns = { 'range' } },
    output = { patterns = { 'output', 'out' } },
    gr = { patterns = { 'telemetry', 'gr', 'gain reduction' } },
    ftype = { patterns = { 'filter type', 'filter mode', 'type' } },
  }, cache, 'rm_deesser')

  reaper.ImGui_Text(ctx, 'RM Deesser')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Threshold', map.threshold)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  knob(ctx, track, fx, ui, scale, 'Freq', map.freq)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  knob(ctx, track, fx, ui, scale, 'Range', map.range)

  reaper.ImGui_Dummy(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Type', map.ftype)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  knob(ctx, track, fx, ui, scale, 'Output', map.output)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  meter(ctx, track, fx, ui, scale, map.gr)
end

function panel.clear_cache()
  for k in pairs(cache) do
    cache[k] = nil
  end
end

return panel
