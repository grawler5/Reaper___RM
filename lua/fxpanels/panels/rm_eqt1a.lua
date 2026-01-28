local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 800, win_h = 500, scale_mult = 1.0 }

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
  local changed, nv = ui.knob_norm(ctx, '##rm_eqt1a_' .. label, v, scale, 56, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    lsf = { patterns = { 'lsf' } },
    push = { patterns = { 'push' } },
    pull = { patterns = { 'pull' } },
    peak_freq = { patterns = { 'freq peak', 'peak freq' } },
    mid_q = { patterns = { 'mid q', ' q' } },
    mid_gain = { patterns = { 'gain (db)', 'mid gain', 'gain' } },
    hsf = { patterns = { 'hsf' } },
    high_gain = { patterns = { 'high gain', 'hsf gain' } },
    atten_sel = { patterns = { 'atten', 'freq h' } },
    bypass = { patterns = { 'bypass', 'power', 'enable', 'active', 'on/off' } },
    output = { patterns = { 'output', 'volume' } },
  }, cache, 'rm_eqt1a')

  reaper.ImGui_Text(ctx, 'RM EQT-1A')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'LSF', map.lsf)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Push', map.push)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Pull', map.pull)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Peak Freq', map.peak_freq)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Mid Q', map.mid_q)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Mid Gain', map.mid_gain)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'HSF', map.hsf)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'High Gain', map.high_gain)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Atten Sel', map.atten_sel)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Output', map.output)
end

function panel.clear_cache()
  for k in pairs(cache) do
    cache[k] = nil
  end
end

return panel
