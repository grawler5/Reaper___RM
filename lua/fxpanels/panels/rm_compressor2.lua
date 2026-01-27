local compat = require('fxpanels.compat')
local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 720, win_h = 620, scale_mult = 0.78 }

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
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local function default_norm(param)
    if params.get_default_norm then
      return params.get_default_norm(track, fx, param)
    end
    return 0.5
  end

  local function with_group(fn)
    if reaper.ImGui_BeginGroup then
      reaper.ImGui_BeginGroup(ctx)
      local ok, err = xpcall(function()
        if fn then fn() end
      end, debug.traceback)
      reaper.ImGui_EndGroup(ctx)
      if not ok then error(err) end
    elseif fn then
      fn()
    end
  end

  if not compat.has_drawlist() then
    reaper.ImGui_Text(ctx, 'RM Compressor2')
    reaper.ImGui_Separator(ctx)
    local th = params.get_norm(track, fx, P.threshold)
    local th_fmt = params.get_formatted(track, fx, P.threshold)
    local def = default_norm(P.threshold)
    local ch, nv = ui.vslider(ctx, '##rm_comp2_thresh', th, scale, 220, th_fmt, def)
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
  local left_w = 195 * scale
  local right_w = 110 * scale
  local min_mid = 320 * scale
  local mid_w = math.max(min_mid, (avail_w or 0) - left_w - right_w - gap * 2)
  local card_h = math.max(320 * scale, (avail_h or 0) - 16 * scale)

  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local function draw_readout(text, x, y, w, h)
    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.08, 0.09, 0.11, 1.0)
    local bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.65)
    local txc = reaper.ImGui_ColorConvertDouble4ToU32(0.92, 0.92, 0.92, 0.9)
    reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 6 * scale)
    reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 6 * scale, 0, 1.0)
    if reaper.ImGui_CalcTextSize then
      local tw, th = reaper.ImGui_CalcTextSize(ctx, text)
      local tx = x + (w - (tw or 0)) * 0.5
      local ty = y + (h - (th or 0)) * 0.5
      reaper.ImGui_DrawList_AddText(dl, tx, ty, txc, text)
    else
      reaper.ImGui_DrawList_AddText(dl, x + 6 * scale, y + 4 * scale, txc, text)
    end
  end

  local function draw_card(title, w, h, fn)
    local x0, y0 = compat.get_cursor_screen_pos(ctx)
    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.10, 0.11, 0.13, 1.0)
    local bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.6)
    local title_col = reaper.ImGui_ColorConvertDouble4ToU32(0.88, 0.88, 0.90, 0.9)
    reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + w, y0 + h, bg, 10 * scale)
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + w, y0 + h, bd, 10 * scale, 0, 1.0)
    if title then
      reaper.ImGui_DrawList_AddText(dl, x0 + 10 * scale, y0 + 8 * scale, title_col, title)
    end
    compat.set_cursor_screen_pos(ctx, x0 + 12 * scale, y0 + 30 * scale)
    if fn then fn(w - 24 * scale, h - 42 * scale, x0, y0) end
    compat.set_cursor_screen_pos(ctx, x0, y0)
    reaper.ImGui_Dummy(ctx, w, h)
  end

  -- Left column: Threshold card
  with_group(function()
    draw_card('THRESHOLD', left_w, card_h, function(inner_w, inner_h, card_x, card_y)
      local th = params.get_norm(track, fx, P.threshold)
      local th_fmt = params.get_formatted(track, fx, P.threshold)
      local gr_db = params.get_raw(track, fx, P.gr_db)
      local gr_norm = compat.clamp((gr_db or 0) / 24.0, 0, 1)
      local slider_h = math.max(160 * scale, inner_h - 120 * scale)

    local readout_w = 72 * scale
    local readout_h = 26 * scale
    local readout_x = card_x + (left_w - readout_w) * 0.5
    local readout_y = card_y + 36 * scale
    draw_readout(th_fmt or '—', readout_x, readout_y, readout_w, readout_h)

    local inner_x, inner_y = compat.get_cursor_screen_pos(ctx)
    compat.set_cursor_screen_pos(ctx, inner_x, inner_y + 40 * scale)

      with_group(function()
        local def = default_norm(P.threshold)
        local ch, nv = ui.vslider(ctx, '##rm_comp2_thresh', th, scale, slider_h, nil, def)
        if ch then params.set_norm(track, fx, P.threshold, nv) end
      end)

    reaper.ImGui_SameLine(ctx, 0, 16 * scale)
    ui.meter_v(ctx, gr_norm, scale, slider_h)

    local x0, y0 = compat.get_cursor_screen_pos(ctx)
    local label_col = reaper.ImGui_ColorConvertDouble4ToU32(0.85, 0.86, 0.88, 0.8)
    local meter_readout_w = (inner_w - 8 * scale) / 2
    local meter_readout_h = 26 * scale
    local row_y = y0 + slider_h + 10 * scale
    reaper.ImGui_DrawList_AddText(dl, x0, row_y - 16 * scale, label_col, 'IN')
    reaper.ImGui_DrawList_AddText(dl, x0 + meter_readout_w + 8 * scale, row_y - 16 * scale, label_col, 'GR')
    draw_readout(format_meter_value(P.in_peak), x0, row_y, meter_readout_w, meter_readout_h)
    local gr_text = string.format('%.1f dB', gr_db or 0)
    draw_readout(gr_text, x0 + meter_readout_w + 8 * scale, row_y, meter_readout_w, meter_readout_h)

    local sc = params.get_norm(track, fx, P.sidechain) > 0.5
    reaper.ImGui_Dummy(ctx, 1, 12 * scale)
    local btn_w = (inner_w - 8 * scale) / 2
    local btn_h = 28 * scale
    reaper.ImGui_PushStyleVar(ctx, compat.resolve_enum(reaper.ImGui_StyleVar_FrameRounding) or reaper.ImGui_StyleVar_FrameRounding, 10 * scale)
    if sc then
      ui.push_color(ctx, reaper.ImGui_Col_Button, 0.18, 0.19, 0.22, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.22, 0.23, 0.26, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.16, 0.17, 0.20, 1.0)
    else
      ui.push_color(ctx, reaper.ImGui_Col_Button, 0.22, 0.22, 0.24, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.26, 0.26, 0.28, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.18, 0.18, 0.20, 1.0)
    end
    if reaper.ImGui_Button(ctx, 'Main', btn_w, btn_h) then
      params.set_norm(track, fx, P.sidechain, 0)
    end
    pcall(reaper.ImGui_PopStyleColor, ctx, 3)
    reaper.ImGui_SameLine(ctx, 0, 8 * scale)
    if sc then
      ui.push_color(ctx, reaper.ImGui_Col_Button, 0.22, 0.22, 0.24, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.26, 0.26, 0.28, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.18, 0.18, 0.20, 1.0)
    else
      ui.push_color(ctx, reaper.ImGui_Col_Button, 0.18, 0.19, 0.22, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.22, 0.23, 0.26, 1.0)
      ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.16, 0.17, 0.20, 1.0)
    end
    if reaper.ImGui_Button(ctx, 'Returns', btn_w, btn_h) then
      params.set_norm(track, fx, P.sidechain, 1)
    end
    pcall(reaper.ImGui_PopStyleColor, ctx, 3)
    pcall(reaper.ImGui_PopStyleVar, ctx, 1)
  end)
  end)

  reaper.ImGui_SameLine(ctx, 0, gap)

  -- Middle column: Envelope + Filter + Options
  with_group(function()
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
  end)

  reaper.ImGui_SameLine(ctx, 0, gap)

  -- Right column: Output card
  with_group(function()
    draw_card('OUTPUT', right_w, card_h, function(inner_w, inner_h)
      local out = params.get_norm(track, fx, P.output)
      local slider_h = math.max(160 * scale, inner_h - 120 * scale)
      local def = default_norm(P.output)
      local ch_out, nv_out = ui.vslider(ctx, '##rm_comp2_out', out, scale, slider_h, nil, def)
      if ch_out then params.set_norm(track, fx, P.output, nv_out) end
      reaper.ImGui_Text(ctx, 'OUT')
    end)
  end)

end

return panel
