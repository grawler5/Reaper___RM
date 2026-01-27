local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 920, win_h = 520, scale_mult = 1.0 }

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
  local changed, nv = ui.knob_norm(ctx, '##rm_delay_' .. label, v, scale, size or 50, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    delay = { patterns = { 'delay (ms)', 'delay', 'time (ms)', 'time' } },
    feedback = { patterns = { 'feedback' } },
    mix_in = { patterns = { 'mix in' } },
    dry_wet = { patterns = { 'dry/wet', 'dry wet', 'mix dry', 'mix dry/wet' } },
    width = { patterns = { 'ping-pong width', 'width', 'ping pong width' } },
    sync = { patterns = { 'tempo sync', 'sync' } },
    dist = { patterns = { 'distortion', 'dist' } },
    tape = { patterns = { 'tape' } },
    crush = { patterns = { 'crush' } },
    hpf = { patterns = { 'hpf' } },
    lpf = { patterns = { 'lpf' } },
  }, cache, 'rm_delaymachine')

  reaper.ImGui_Text(ctx, 'RM Delay Machine')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Delay', map.delay)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Feedback', map.feedback)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Mix In', map.mix_in)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Dry/Wet', map.dry_wet)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Width', map.width)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Sync', map.sync)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Dist', map.dist)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Tape', map.tape)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Crush', map.crush)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'HPF', map.hpf)
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'LPF', map.lpf)
end

return panel
