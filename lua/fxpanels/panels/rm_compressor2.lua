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

  if not compat.has_drawlist() then
    reaper.ImGui_Text(ctx, 'RM Compressor2')
    reaper.ImGui_Separator(ctx)
    local th = params.get_norm(track, fx, P.threshold)
    local th_fmt = params.get_formatted(track, fx, P.threshold)
    local ch, nv = ui.vslider(ctx, '##rm_comp2_thresh', th, scale, 220, th_fmt)
    if ch then params.set_norm(track, fx, P.threshold, nv) end
    draw_param_knob(ctx, track, fx, ui, scale, 'ATT', P.attack, 54)
    reaper.ImGui_SameLine(ctx)
    draw_param_knob(ctx, track, fx, ui, scale, 'REL', P.release, 54)
    reaper.ImGui_SameLine(ctx)
    draw_param_knob(ctx, track, fx, ui, scale, 'RATIO', P.ratio, 54)
    draw_param_hslider(ctx, track, fx, ui, scale, 'LP', P.det_lp, 240)
    draw_param_hslider(ctx, track, fx, ui, scale, 'HP', P.det_hp, 240)
    draw_toggle_row(ctx, track, fx, ui, scale)
    return
  end

  local function format_meter_value(param)
    local fmt = params.get_formatted(track, fx, param)
    if fmt and fmt ~= '' then return fmt end
    local v = params.get_norm(track, fx, param) or 0
    return string.format('%.1f', v * 100)
  end

  local avail_w, avail_h = 0, 0
  if reaper.ImGui_GetContentRegionAvail then
    avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  end
  local gap = 14 * scale
  local left_w = 210 * scale
  local right_w = 150 * scale
  local min_mid = 320 * scale
  local mid_w = math.max(min_mid, (avail_w or 0) - left_w - right_w - gap * 2)
  local card_h = math.min(320 * scale, (avail_h or 0) - 80 * scale)

  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local function draw_card(title, w, h, fn)
    local x0, y0 = compat.get_cursor_screen_pos(ctx)
    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.12, 0.12, 0.14, 1.0)
    local bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.6)
    local title_col = reaper.ImGui_ColorConvertDouble4ToU32(0.88, 0.88, 0.90, 0.9)
    reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + w, y0 + h, bg, 10 * scale)
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + w, y0 + h, bd, 10 * scale, 0, 1.0)
    if title then
      reaper.ImGui_DrawList_AddText(dl, x0 + 10 * scale, y0 + 8 * scale, title_col, title)
    end
    compat.set_cursor_screen_pos(ctx, x0 + 12 * scale, y0 + 30 * scale)
    if fn then fn(w - 24 * scale, h - 42 * scale) end
    compat.set_cursor_screen_pos(ctx, x0, y0)
    reaper.ImGui_Dummy(ctx, w, h)
  end

  -- Left column: Threshold card
  reaper.ImGui_BeginGroup(ctx)
  draw_card('THRESHOLD', left_w, card_h, function(inner_w, inner_h)
    local th = params.get_norm(track, fx, P.threshold)
    local th_fmt = params.get_formatted(track, fx, P.threshold)
    local gr_db = params.get_raw(track, fx, P.gr_db)
    local gr_norm = compat.clamp((gr_db or 0) / 24.0, 0, 1)

    local slider_h = inner_h - 60 * scale

    reaper.ImGui_BeginGroup(ctx)
    local ch, nv = ui.vslider(ctx, '##rm_comp2_thresh', th, scale, slider_h, th_fmt)
    if ch then params.set_norm(track, fx, P.threshold, nv) end
    reaper.ImGui_EndGroup(ctx)

    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    ui.meter_v(ctx, gr_norm, scale, slider_h)

    reaper.ImGui_Dummy(ctx, 1, 6 * scale)
    reaper.ImGui_Text(ctx, 'IN')
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
    reaper.ImGui_Text(ctx, 'THR')
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
    reaper.ImGui_Text(ctx, 'GR')
    reaper.ImGui_Text(ctx, format_meter_value(P.in_peak))
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    reaper.ImGui_Text(ctx, th_fmt or '—')
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    local gr_text = string.format('%.1f dB', gr_db or 0)
    reaper.ImGui_Text(ctx, gr_text)

    local sc = params.get_norm(track, fx, P.sidechain)
    local changed, on = ui.toggle(ctx, sc > 0.5 and 'Detector: SC' or 'Detector: Main', sc > 0.5, scale)
    if changed then params.set_norm(track, fx, P.sidechain, on and 1 or 0) end
  end)
  reaper.ImGui_EndGroup(ctx)

  reaper.ImGui_SameLine(ctx, 0, gap)

  -- Middle column: Envelope + Filter + Options
  reaper.ImGui_BeginGroup(ctx)
  draw_card('ENVELOPE', mid_w, card_h * 0.52, function(inner_w)
    draw_param_hslider(ctx, track, fx, ui, scale, 'Attack', P.attack, inner_w - 30 * scale)
    draw_param_hslider(ctx, track, fx, ui, scale, 'Release', P.release, inner_w - 30 * scale)
    draw_param_hslider(ctx, track, fx, ui, scale, 'Ratio', P.ratio, inner_w - 30 * scale)
    draw_param_hslider(ctx, track, fx, ui, scale, 'Knee', P.knee, inner_w - 30 * scale)
  end)

  reaper.ImGui_Dummy(ctx, 1, 10 * scale)
  draw_card('FILTER', mid_w, card_h * 0.30, function(inner_w)
    draw_param_hslider(ctx, track, fx, ui, scale, 'LP', P.det_lp, inner_w - 30 * scale)
    draw_param_hslider(ctx, track, fx, ui, scale, 'HP', P.det_hp, inner_w - 30 * scale)
  end)

  reaper.ImGui_Dummy(ctx, 1, 10 * scale)
  reaper.ImGui_Text(ctx, 'OPTIONS')
  draw_toggle_row(ctx, track, fx, ui, scale)
  reaper.ImGui_EndGroup(ctx)

  reaper.ImGui_SameLine(ctx, 0, gap)

  -- Right column: Output card
  reaper.ImGui_BeginGroup(ctx)
  draw_card('OUTPUT', right_w, card_h, function(inner_w, inner_h)
    local out = params.get_norm(track, fx, P.output)
    local out_fmt = params.get_formatted(track, fx, P.output)
    local slider_h = inner_h - 60 * scale
    local ch_out, nv_out = ui.vslider(ctx, '##rm_comp2_out', out, scale, slider_h, out_fmt)
    if ch_out then params.set_norm(track, fx, P.output, nv_out) end
    reaper.ImGui_Text(ctx, 'OUT')
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    reaper.ImGui_Text(ctx, format_meter_value(P.out_peak))
  end)
  reaper.ImGui_EndGroup(ctx)

  reaper.ImGui_Dummy(ctx, 1, 8 * scale)

  local sc = params.get_norm(track, fx, P.sidechain)
  local tr = params.get_norm(track, fx, P.trick)
  local changed
  changed, sc = ui.toggle(ctx, 'Sidechain', sc > 0.5, scale)
  if changed then params.set_norm(track, fx, P.sidechain, sc and 1 or 0) end
  reaper.ImGui_SameLine(ctx)
  changed, tr = ui.toggle(ctx, 'Trick', tr > 0.5, scale)
  if changed then params.set_norm(track, fx, P.trick, tr and 1 or 0) end
end

return panel
