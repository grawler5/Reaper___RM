local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

local panel = {}

-- RM Delay Machine - lightweight native UI inspired by the Web UI (rmDelayMachinePanel).
-- Note: Web UI has an alternate DM2 skin with LED segments; here we keep the same information
-- but draw everything with standard ImGui primitives (no textures).
panel.meta = { win_w = 920, win_h = 520, scale_mult = 1.0 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function knob(ctx, track, fx, ui, scale, label, idx, size)
  if idx == nil then
    ui.knob_norm(ctx, '##rm_dm_stub_' .. label, 0, scale, size or 54, label, '—')
    return
  end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, '##rm_delay_' .. label, v, scale, size or 54, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

local function toggle(ctx, track, fx, ui, scale, label, idx)
  if idx == nil then
    ui.toggle(ctx, label, false, scale)
    return
  end
  local v = clamp01(params.get_norm(track, fx, idx)) > 0.5
  local changed, nv = ui.toggle(ctx, label, v, scale)
  if changed then params.set_norm(track, fx, idx, nv and 1 or 0) end
end

local function led_seg(ctx, track, fx, ui, scale, title, idx)
  local val = (idx ~= nil) and (params.get_formatted(track, fx, idx) or '—') or '—'
  local opened, is_child, scope = ui.card_begin(ctx, '##rm_dm_led_' .. title, scale, 0, 0)
  if opened then
    ui.caption_muted(ctx, title)
    ui.big_value(ctx, val)
  end
  ui.card_end(ctx, is_child, scope)
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    delay = { patterns = { 'delay (ms)', 'delay', 'time (ms)', 'time' } },
    feedback = { patterns = { 'feedback' } },
    mix_in = { patterns = { 'mix in' } },
    dry_wet = { patterns = { 'dry/?wet', 'dry wet', 'mix dry', 'mix dry/?wet' } },
    width = { patterns = { 'ping%-?pong width', 'width', 'ping pong width' } },
    sync = { patterns = { 'tempo sync', 'sync' } },
    dist = { patterns = { 'distortion', 'dist' } },
    tape = { patterns = { 'tape' } },
    crush = { patterns = { 'crush' } },
    hpf = { patterns = { 'hpf' } },
    lpf = { patterns = { '\blpf\b' } },
    bpm = { patterns = { 'telemetry.*bpm', '\bbpm\b' } },
  }, cache, 'rm_delaymachine')

  -- Top LED bar (like the Web UI DM2) - compact summary of key params.
  local opened, is_child, scope = ui.card_begin(ctx, '##rm_dm_ledbar', scale, 0, 0)
  if opened then
    ui.section_title(ctx, 'RM DELAY MACHINE')
    reaper.ImGui_Separator(ctx)

    led_seg(ctx, track, fx, ui, scale, 'TIME', map.delay)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    led_seg(ctx, track, fx, ui, scale, 'FB', map.feedback)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    led_seg(ctx, track, fx, ui, scale, 'MIX', map.dry_wet)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    led_seg(ctx, track, fx, ui, scale, 'WIDTH', map.width)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    led_seg(ctx, track, fx, ui, scale, 'HPF', map.hpf)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    led_seg(ctx, track, fx, ui, scale, 'LPF', map.lpf)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    led_seg(ctx, track, fx, ui, scale, 'BPM', map.bpm)
  end
  ui.card_end(ctx, is_child, scope)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)

  -- Main controls: knobs + option toggles.
  local opened2, is_child2, scope2 = ui.card_begin(ctx, '##rm_dm_main', scale, 0, 0)
  if opened2 then
    ui.section_title(ctx, 'CONTROLS')
    reaper.ImGui_Separator(ctx)

    knob(ctx, track, fx, ui, scale, 'TIME', map.delay, 60)
    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    knob(ctx, track, fx, ui, scale, 'FB', map.feedback, 60)
    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    knob(ctx, track, fx, ui, scale, 'MIX IN', map.mix_in, 60)
    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    knob(ctx, track, fx, ui, scale, 'DRY/WET', map.dry_wet, 60)
    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    knob(ctx, track, fx, ui, scale, 'WIDTH', map.width, 60)

    reaper.ImGui_Dummy(ctx, 0, 14 * scale)

    knob(ctx, track, fx, ui, scale, 'HPF', map.hpf, 60)
    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    knob(ctx, track, fx, ui, scale, 'LPF', map.lpf, 60)

    reaper.ImGui_Dummy(ctx, 0, 10 * scale)
    toggle(ctx, track, fx, ui, scale, 'Tempo Sync', map.sync)
    reaper.ImGui_SameLine(ctx, 0, 14 * scale)
    toggle(ctx, track, fx, ui, scale, 'Dist', map.dist)
    reaper.ImGui_SameLine(ctx, 0, 14 * scale)
    toggle(ctx, track, fx, ui, scale, 'Tape', map.tape)
    reaper.ImGui_SameLine(ctx, 0, 14 * scale)
    toggle(ctx, track, fx, ui, scale, 'Crush', map.crush)
  end
  ui.card_end(ctx, is_child2, scope2)
end

return panel
