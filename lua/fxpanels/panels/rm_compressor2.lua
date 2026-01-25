local compat = require('fxpanels.compat')
local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 820, win_h = 560, scale_mult = 1.0 }

local P = {
  threshold = 0,
  knee = 1,
  ratio = 2,
  attack = 3,
  release = 4,
  output = 5,
  trick = 6,
  feedback = 7,
  sidechain = 8,
  metermode = 9,
  meterspeed = 10,
  dry = 11,
  scaling = 12,
  in_peak = 13,
  sc_peak = 14,
  out_peak = 15,
  gr_db = 16,
  det_lp = 17,
  det_hp = 18,
  bpm_sync = 19,
  auto_makeup = 20,
  limit_output = 21,
}

local function draw_toggle_row(ctx, track, fx, ui, scale)
  local changed, v

  v = params.get_norm(track, fx, P.bpm_sync)
  changed, v = ui.toggle(ctx, 'BPM Sync', v > 0.5, scale)
  if changed then params.set_norm(track, fx, P.bpm_sync, v and 1 or 0) end
  reaper.ImGui_SameLine(ctx)

  v = params.get_norm(track, fx, P.auto_makeup)
  changed, v = ui.toggle(ctx, 'Auto Makeup', v > 0.5, scale)
  if changed then params.set_norm(track, fx, P.auto_makeup, v and 1 or 0) end
  reaper.ImGui_SameLine(ctx)

  v = params.get_norm(track, fx, P.limit_output)
  changed, v = ui.toggle(ctx, 'Limit Output', v > 0.5, scale)
  if changed then params.set_norm(track, fx, P.limit_output, v and 1 or 0) end
end

local function draw_param_knob(ctx, track, fx, ui, scale, label, param, size)
  local v = params.get_norm(track, fx, param)
  local fmt = params.get_formatted(track, fx, param)
  local id = '##' .. label .. '_' .. tostring(param)
  local changed, nv = ui.knob_norm(ctx, id, v, scale, size, label, fmt)
  if changed then
    params.set_norm(track, fx, param, nv)
  end
end

local function draw_param_hslider(ctx, track, fx, ui, scale, label, param, width)
  local v = params.get_norm(track, fx, param)
  local fmt = params.get_formatted(track, fx, param)
  reaper.ImGui_PushItemWidth(ctx, (width or 260) * scale)
  local changed, nv = reaper.ImGui_SliderDouble(ctx, label, v, 0.0, 1.0)
  reaper.ImGui_PopItemWidth(ctx)
  if fmt and fmt ~= '' then
    reaper.ImGui_SameLine(ctx)
    reaper.ImGui_Text(ctx, fmt)
  end
  if changed then
    params.set_norm(track, fx, param, nv)
  end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0)

  reaper.ImGui_Text(ctx, 'R M  C O M P R E S S O R  2')
  reaper.ImGui_Text(ctx, 'Dynamics / sidechain / filters')
  reaper.ImGui_Separator(ctx)

  -- Meters row
  local in_pk = params.get_norm(track, fx, P.in_peak)
  local out_pk = params.get_norm(track, fx, P.out_peak)
  local gr_db = params.get_raw(track, fx, P.gr_db)
  local gr_norm = compat.clamp((gr_db or 0) / 24.0, 0, 1)

  reaper.ImGui_BeginGroup(ctx)
  reaper.ImGui_Text(ctx, 'IN')
  ui.meter_v(ctx, in_pk, scale, 90)
  reaper.ImGui_EndGroup(ctx)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  reaper.ImGui_BeginGroup(ctx)
  reaper.ImGui_Text(ctx, 'GR')
  ui.meter_v(ctx, gr_norm, scale, 90)
  reaper.ImGui_EndGroup(ctx)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  reaper.ImGui_BeginGroup(ctx)
  reaper.ImGui_Text(ctx, 'OUT')
  ui.meter_v(ctx, out_pk, scale, 90)
  reaper.ImGui_EndGroup(ctx)

  reaper.ImGui_Separator(ctx)

  -- Main layout: faders + knobs
  -- NOTE: ReaImGui 0.10.0.2 can assert on TableSetupColumn sizing; use child layout instead.
  local spacing = 12 * scale
  local left_w = 150 * scale
  local right_w = 150 * scale

  -- Left: Threshold
  do
    local opened, is_child = ui._begin_child(ctx, '##rm_comp2_left', left_w, 0, false)
    if opened then
      local th = params.get_norm(track, fx, P.threshold)
      local th_fmt = params.get_formatted(track, fx, P.threshold)
      reaper.ImGui_Text(ctx, 'THRESH')
      local ch, nv = ui.vslider(ctx, '##rm_comp2_thresh', th, scale, 260, th_fmt)
      if ch then params.set_norm(track, fx, P.threshold, nv) end
    end
    if is_child then reaper.ImGui_EndChild(ctx) end
  end

  reaper.ImGui_SameLine(ctx, 0, spacing)

  -- Center: Knobs / filters / toggles
  local avail_w = 0
  if reaper.ImGui_GetContentRegionAvail then
    local w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
    if type(w) == 'number' then avail_w = w end
  end
  local center_w = 0
  if avail_w > (right_w + spacing + 120 * scale) then
    center_w = avail_w - right_w - spacing
  end

  do
    local opened, is_child = ui._begin_child(ctx, '##rm_comp2_center', center_w, 0, false)
    if opened then
      reaper.ImGui_Text(ctx, 'ENVELOPE')
      reaper.ImGui_Separator(ctx)

      reaper.ImGui_BeginGroup(ctx)
      draw_param_knob(ctx, track, fx, ui, scale, 'ATT', P.attack, 54)
      reaper.ImGui_SameLine(ctx, 0, 18 * scale)
      draw_param_knob(ctx, track, fx, ui, scale, 'REL', P.release, 54)
      reaper.ImGui_SameLine(ctx, 0, 18 * scale)
      draw_param_knob(ctx, track, fx, ui, scale, 'RATIO', P.ratio, 54)
      reaper.ImGui_SameLine(ctx, 0, 18 * scale)
      draw_param_knob(ctx, track, fx, ui, scale, 'KNEE', P.knee, 54)
      reaper.ImGui_EndGroup(ctx)

      reaper.ImGui_Dummy(ctx, 1, 10 * scale)
      reaper.ImGui_Text(ctx, 'DETECTOR FILTER')
      reaper.ImGui_Separator(ctx)
      draw_param_hslider(ctx, track, fx, ui, scale, 'LP', P.det_lp, 320)
      draw_param_hslider(ctx, track, fx, ui, scale, 'HP', P.det_hp, 320)

      reaper.ImGui_Dummy(ctx, 1, 10 * scale)
      draw_toggle_row(ctx, track, fx, ui, scale)
    end
    if is_child then reaper.ImGui_EndChild(ctx) end
  end

  reaper.ImGui_SameLine(ctx, 0, spacing)

  -- Right: Output
  do
    local opened, is_child = ui._begin_child(ctx, '##rm_comp2_right', right_w, 0, false)
    if opened then
      local out = params.get_norm(track, fx, P.output)
      local out_fmt = params.get_formatted(track, fx, P.output)
      reaper.ImGui_Text(ctx, 'OUTPUT')
      local ch_out, nv_out = ui.vslider(ctx, '##rm_comp2_out', out, scale, 260, out_fmt)
      if ch_out then params.set_norm(track, fx, P.output, nv_out) end
    end
    if is_child then reaper.ImGui_EndChild(ctx) end
  end

  reaper.ImGui_Dummy(ctx, 1, 10 * scale)

  -- Secondary toggles
  local sc = params.get_norm(track, fx, P.sidechain)
  local tr = params.get_norm(track, fx, P.trick)
  reaper.ImGui_Text(ctx, 'EXTRAS')
  local changed
  changed, sc = ui.toggle(ctx, 'Sidechain', sc > 0.5, scale)
  if changed then params.set_norm(track, fx, P.sidechain, sc and 1 or 0) end
  reaper.ImGui_SameLine(ctx)
  changed, tr = ui.toggle(ctx, 'Trick', tr > 0.5, scale)
  if changed then params.set_norm(track, fx, P.trick, tr and 1 or 0) end
end

return panel
