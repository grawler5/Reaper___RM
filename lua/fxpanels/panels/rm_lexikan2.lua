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
  local changed, nv = ui.knob_norm(ctx, '##rm_lexi2_' .. label, v, scale, 50, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    density = { patterns = { 'density' } },
    pre_delay = { patterns = { 'predelay' } },
    er_tail = { patterns = { 'er vs tail', 'er tail', 'er/tail' } },
    gap = { patterns = { 'gapdelay', 'gap delay' } },
    lpf = { patterns = { 'lowpass', 'filter' } },
    tilt = { patterns = { 'tilt' } },
    dry_wet = { patterns = { 'drywet', 'dry wet' } },
    stereo = { patterns = { 'stereo spread', 'stereospread', 'width' } },
    sync = { patterns = { 'tempo sync', 'sync' } },
    len_note = { patterns = { 'length sync note', 'length note' } },
    pre_note = { patterns = { 'predelay sync note', 'predelay note' } },
    bpm = { patterns = { 'telemetry bpm', 'bpm' } },
  }, cache, 'rm_lexikan2')

  reaper.ImGui_Text(ctx, 'RM Lexikan2')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Density', map.density)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'PreDelay', map.pre_delay)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'ER/Tail', map.er_tail)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Gap', map.gap)

  reaper.ImGui_Dummy(ctx, 0, 8 * scale)
  knob(ctx, track, fx, ui, scale, 'LPF', map.lpf)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Tilt', map.tilt)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Dry/Wet', map.dry_wet)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Stereo', map.stereo)

  reaper.ImGui_Dummy(ctx, 0, 8 * scale)
  knob(ctx, track, fx, ui, scale, 'Sync', map.sync)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Len Note', map.len_note)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Pre Note', map.pre_note)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'BPM', map.bpm)
end

function panel.clear_cache()
  for k in pairs(cache) do
    cache[k] = nil
  end
end

return panel
