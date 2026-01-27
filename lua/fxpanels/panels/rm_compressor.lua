local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 720, win_h = 620, scale_mult = 1.0 }

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
  local changed, nv = ui.knob_norm(ctx, '##rm_comp_' .. label, v, scale, size or 54, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

local function slider(ctx, track, fx, ui, scale, label, idx, width)
  if idx == nil then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  reaper.ImGui_PushItemWidth(ctx, (width or 240) * scale)
  local changed, nv = reaper.ImGui_SliderDouble(ctx, label, v, 0.0, 1.0)
  reaper.ImGui_PopItemWidth(ctx)
  if fmt and fmt ~= '' then
    reaper.ImGui_SameLine(ctx)
    reaper.ImGui_Text(ctx, fmt)
  end
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold', 'thresh' } },
    attack = { patterns = { 'attack' } },
    release = { patterns = { 'release' } },
    knee = { patterns = { 'knee' } },
    ratio = { patterns = { 'ratio' } },
    detect = { patterns = { 'detect', 'detector', 'side chain', 'sidechain', 'source' } },
    lp = { patterns = { 'lp', 'low pass', 'lowpass' } },
    hp = { patterns = { 'hp', 'high pass', 'highpass' } },
    bpm_sync = { patterns = { 'bpm sync', 'tempo sync', 'sync' } },
    auto_makeup = { patterns = { 'auto makeup', 'makeup' } },
    limit_out = { patterns = { 'limit out', 'output limit' } },
    out_gain = { patterns = { 'output gain', 'out gain', 'output' } },
    in_peak = { patterns = { 'telemetry', 'input peak', 'in peak' } },
    out_peak = { patterns = { 'telemetry', 'out peak' } },
    gr = { patterns = { 'telemetry', 'gr', 'gain reduction' } },
  }, cache, 'rm_compressor')

  reaper.ImGui_Text(ctx, 'RM Compressor')
  reaper.ImGui_Separator(ctx)

  knob(ctx, track, fx, ui, scale, 'Threshold', map.threshold)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Attack', map.attack)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Release', map.release)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  knob(ctx, track, fx, ui, scale, 'Knee', map.knee)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Ratio', map.ratio)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Output', map.out_gain)

  reaper.ImGui_Dummy(ctx, 0, 10 * scale)
  slider(ctx, track, fx, ui, scale, 'LP', map.lp, 220)
  slider(ctx, track, fx, ui, scale, 'HP', map.hp, 220)

  reaper.ImGui_Dummy(ctx, 0, 8 * scale)
  if map.bpm_sync ~= nil then
    local v = clamp01(params.get_norm(track, fx, map.bpm_sync))
    local changed, nv = ui.toggle(ctx, 'BPM Sync', v > 0.5, scale)
    if changed then params.set_norm(track, fx, map.bpm_sync, nv and 1 or 0) end
  end
  reaper.ImGui_SameLine(ctx, 0, 16 * scale)
  if map.auto_makeup ~= nil then
    local v = clamp01(params.get_norm(track, fx, map.auto_makeup))
    local changed, nv = ui.toggle(ctx, 'Auto Makeup', v > 0.5, scale)
    if changed then params.set_norm(track, fx, map.auto_makeup, nv and 1 or 0) end
  end
  reaper.ImGui_SameLine(ctx, 0, 16 * scale)
  if map.limit_out ~= nil then
    local v = clamp01(params.get_norm(track, fx, map.limit_out))
    local changed, nv = ui.toggle(ctx, 'Limit Output', v > 0.5, scale)
    if changed then params.set_norm(track, fx, map.limit_out, nv and 1 or 0) end
  end

  reaper.ImGui_Dummy(ctx, 0, 12 * scale)
  if map.in_peak ~= nil then
    ui.meter_v(ctx, clamp01(params.get_norm(track, fx, map.in_peak)), scale, 150)
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  end
  if map.gr ~= nil then
    ui.meter_v(ctx, clamp01(params.get_norm(track, fx, map.gr)), scale, 150)
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  end
  if map.out_peak ~= nil then
    ui.meter_v(ctx, clamp01(params.get_norm(track, fx, map.out_peak)), scale, 150)
  end
end

return panel
