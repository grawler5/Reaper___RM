local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 920, win_h = 720, scale_mult = 1.0 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function knob(ctx, track, fx, ui, scale, label, idx, size)
  if idx == nil then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, '##rm_eq4_' .. label, v, scale, size or 48, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

local function knob_row(ctx, track, fx, ui, scale, label_a, idx_a, label_b, idx_b, label_c, idx_c)
  knob(ctx, track, fx, ui, scale, label_a, idx_a)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, label_b, idx_b)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, label_c, idx_c)
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    locut_on = { patterns = { 'low cut on', 'locut on', 'lowcut on', 'lo cut on' } },
    locut_freq = { patterns = { 'low cut freq', 'locut freq', 'lowcut freq', 'lo cut freq' } },
    hicut_on = { patterns = { 'high cut on', 'hicut on', 'highcut on', 'hi cut on' } },
    hicut_freq = { patterns = { 'high cut freq', 'hicut freq', 'highcut freq', 'hi cut freq' } },
    output = { patterns = { 'output' } },
    b1_freq = { patterns = { 'b1 freq', 'band 1 freq', '1 freq' } },
    b1_gain = { patterns = { 'b1 gain', 'band 1 gain', '1 gain' } },
    b1_q = { patterns = { 'b1 q', 'band 1 q', '1 q' } },
    b2_freq = { patterns = { 'b2 freq', 'band 2 freq', '2 freq' } },
    b2_gain = { patterns = { 'b2 gain', 'band 2 gain', '2 gain' } },
    b2_q = { patterns = { 'b2 q', 'band 2 q', '2 q' } },
    b3_freq = { patterns = { 'b3 freq', 'band 3 freq', '3 freq' } },
    b3_gain = { patterns = { 'b3 gain', 'band 3 gain', '3 gain' } },
    b3_q = { patterns = { 'b3 q', 'band 3 q', '3 q' } },
    b4_freq = { patterns = { 'b4 freq', 'band 4 freq', '4 freq' } },
    b4_gain = { patterns = { 'b4 gain', 'band 4 gain', '4 gain' } },
    b4_q = { patterns = { 'b4 q', 'band 4 q', '4 q' } },
  }, cache, 'rm_eq4')

  reaper.ImGui_Text(ctx, 'RM EQ4')
  reaper.ImGui_Separator(ctx)

  knob_row(ctx, track, fx, ui, scale, 'LoCut', map.locut_freq, 'HiCut', map.hicut_freq, 'Output', map.output)
  reaper.ImGui_Dummy(ctx, 0, 10 * scale)

  reaper.ImGui_Text(ctx, 'Band 1')
  knob_row(ctx, track, fx, ui, scale, 'Freq', map.b1_freq, 'Gain', map.b1_gain, 'Q', map.b1_q)
  reaper.ImGui_Dummy(ctx, 0, 8 * scale)

  reaper.ImGui_Text(ctx, 'Band 2')
  knob_row(ctx, track, fx, ui, scale, 'Freq', map.b2_freq, 'Gain', map.b2_gain, 'Q', map.b2_q)
  reaper.ImGui_Dummy(ctx, 0, 8 * scale)

  reaper.ImGui_Text(ctx, 'Band 3')
  knob_row(ctx, track, fx, ui, scale, 'Freq', map.b3_freq, 'Gain', map.b3_gain, 'Q', map.b3_q)
  reaper.ImGui_Dummy(ctx, 0, 8 * scale)

  reaper.ImGui_Text(ctx, 'Band 4')
  knob_row(ctx, track, fx, ui, scale, 'Freq', map.b4_freq, 'Gain', map.b4_gain, 'Q', map.b4_q)
end

return panel
