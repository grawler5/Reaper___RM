local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

local panel = {}

panel.meta = { win_w = 420, win_h = 500 }

local BASE_W = 350
local BASE_H = 410

local param_cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function panel_scale(ctx, state)
  local scale = (state and (state.ui_scale or state.scale)) or 1.0
  local base_w = BASE_W * scale
  local base_h = BASE_H * scale
  local avail_w, avail_h = 0, 0
  if reaper.ImGui_GetContentRegionAvail then
    avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  end
  local fit = 1.0
  if type(avail_w) == 'number' and type(avail_h) == 'number' and avail_w > 1 and avail_h > 1 then
    fit = math.min(avail_w / base_w, avail_h / base_h)
  end
  return scale * fit, base_w * fit, base_h * fit
end

local function map_params(track, fx)
  return params.build_map(track, fx, {
    input = { patterns = { 'input' }, default = 0 },
    output = { patterns = { 'output' }, default = 8 },
    low = { patterns = { 'low eq', 'low' }, default = 6 },
    high = { patterns = { 'high eq', 'high' }, default = 7 },
    dist = { patterns = { 'dist' }, default = 9 },
    pre = { patterns = { 'pre on', 'pre' }, default = 10 },
    in_vu = { patterns = { 'telemetry: in vu', 'in vu' }, default = 11 },
    in_peak = { patterns = { 'telemetry: in peak', 'in peak' }, default = 12 },
    out_vu = { patterns = { 'telemetry: out vu', 'out vu' }, default = 13 },
    out_peak = { patterns = { 'telemetry: out peak', 'out peak' }, default = 14 },
    clip = { patterns = { 'clip' }, default = 15 },
  }, param_cache)
end

local function color_u32(r, g, b, a)
  return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
end

local function draw_label(ctx, dl, text, x, y, col)
  if reaper.ImGui_DrawList_AddText then
    reaper.ImGui_DrawList_AddText(dl, x, y, col, text)
  else
    compat.set_cursor_screen_pos(ctx, x, y)
    reaper.ImGui_Text(ctx, text)
  end
end

local function draw_toggle(ctx, dl, label, x, y, w, h, on, scale)
  compat.set_cursor_screen_pos(ctx, x, y)
  local clicked = reaper.ImGui_InvisibleButton(ctx, '##' .. label .. ':' .. tostring(x) .. ':' .. tostring(y), w, h)
  local hovered = reaper.ImGui_IsItemHovered and reaper.ImGui_IsItemHovered(ctx)
  local bg = on and color_u32(0.20, 0.70, 0.35, 1.0) or color_u32(0.20, 0.20, 0.22, 1.0)
  local bd = hovered and color_u32(1, 1, 1, 0.35) or color_u32(0, 0, 0, 0.6)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 6 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 6 * scale, 0, 1.0)
  return clicked
end

local function draw_vu(dl, x, y, w, h, level, peak)
  local bg = color_u32(0.08, 0.08, 0.09, 0.9)
  local bd = color_u32(0, 0, 0, 0.7)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 4)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 4, 0, 1.0)

  local fill_w = w * clamp01(level)
  if fill_w > 0.5 then
    if reaper.ImGui_DrawList_AddRectFilledMultiColor then
      local c1 = color_u32(0.35, 0.95, 0.55, 0.95)
      local c2 = color_u32(0.95, 0.80, 0.35, 0.95)
      local c3 = color_u32(0.95, 0.35, 0.35, 0.95)
      reaper.ImGui_DrawList_AddRectFilledMultiColor(dl, x, y, x + fill_w, y + h, c1, c2, c2, c3)
    else
      local c = color_u32(0.35, 0.95, 0.55, 0.95)
      reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + fill_w, y + h, c, 4)
    end
  end

  local peak_x = x + w * clamp01(peak)
  reaper.ImGui_DrawList_AddRectFilled(dl, peak_x - 1, y, peak_x + 1, y + h, color_u32(1, 1, 1, 0.9))

  local step = 10
  local i = x + step
  while i < x + w do
    reaper.ImGui_DrawList_AddLine(dl, i, y, i, y + h, color_u32(0, 0, 0, 0.5), 1.0)
    i = i + step
  end
end

local function draw_knob(ctx, track, fx, ui, x, y, size, param, scale, id)
  compat.set_cursor_screen_pos(ctx, x, y)
  local v = params.get_norm(track, fx, param)
  local changed, nv = ui.knob_norm(ctx, id, v, scale, size)
  if changed then
    params.set_norm(track, fx, param, nv)
  end
  return v
end

function panel.render(ctx, track, fx, ui, state)
  if not (compat.has_drawlist() and reaper.ImGui_InvisibleButton) then
    reaper.ImGui_Text(ctx, 'RM PreAmp')
    local map = map_params(track, fx)
    local function knob(label, param)
      local v = params.get_norm(track, fx, param)
      local fmt = params.get_formatted(track, fx, param)
      local changed, nv = ui.knob_norm(ctx, '##' .. label, v, 1.0, 60, label, fmt)
      if changed then params.set_norm(track, fx, param, nv) end
    end
    knob('Input', map.input)
    knob('Output', map.output)
    knob('Low', map.low)
    knob('High', map.high)
    local dist = params.get_norm(track, fx, map.dist)
    local changed, on = ui.toggle(ctx, 'Dist', dist > 0.5, 1.0)
    if changed then params.set_norm(track, fx, map.dist, on and 1 or 0) end
    local pre = params.get_norm(track, fx, map.pre)
    changed, on = ui.toggle(ctx, 'Pre', pre > 0.5, 1.0)
    if changed then params.set_norm(track, fx, map.pre, on and 1 or 0) end
    return
  end

  local draw_scale, panel_w, panel_h = panel_scale(ctx, state)
  ui.with_child(ctx, '##rm_preamp_panel', panel_w, panel_h, false, 0, function()
    local dl = reaper.ImGui_GetWindowDrawList(ctx)
    local x0, y0 = compat.get_cursor_screen_pos(ctx)

    local bg = color_u32(0.12, 0.11, 0.10, 1.0)
    local bd = color_u32(0, 0, 0, 0.7)
    reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + panel_w, y0 + panel_h, bg, 8 * draw_scale)
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + panel_h, bd, 8 * draw_scale, 0, 1.0)

    local map = map_params(track, fx)

    local knob_in_x = x0 + 120 * draw_scale
    local knob_in_y = y0 + 50 * draw_scale
    draw_knob(ctx, track, fx, ui, knob_in_x, knob_in_y, 110, map.input, draw_scale, '##pre_in')

    local knob_out_x = x0 + 120 * draw_scale
    local knob_out_y = y0 + 250 * draw_scale
    draw_knob(ctx, track, fx, ui, knob_out_x, knob_out_y, 110, map.output, draw_scale, '##pre_out')

    local knob_low_x = x0 + 30 * draw_scale
    local knob_low_y = y0 + 275 * draw_scale
    draw_knob(ctx, track, fx, ui, knob_low_x, knob_low_y, 60, map.low, draw_scale, '##pre_low')

    local knob_high_x = x0 + 260 * draw_scale
    local knob_high_y = y0 + 275 * draw_scale
    draw_knob(ctx, track, fx, ui, knob_high_x, knob_high_y, 60, map.high, draw_scale, '##pre_high')

    local dist_on = params.get_norm(track, fx, map.dist) > 0.5
    local dist_x = x0 + 30 * draw_scale
    local dist_y = y0 + 81 * draw_scale
    local dist_clicked = draw_toggle(ctx, dl, 'dist', dist_x, dist_y, 48 * draw_scale, 60 * draw_scale, dist_on, draw_scale)
    if dist_clicked then
      params.set_norm(track, fx, map.dist, dist_on and 0 or 1)
    end

    local pre_on = params.get_norm(track, fx, map.pre) > 0.5
    local pre_x = x0 + 260 * draw_scale
    local pre_y = y0 + 81 * draw_scale
    local pre_clicked = draw_toggle(ctx, dl, 'pre', pre_x, pre_y, 48 * draw_scale, 60 * draw_scale, pre_on, draw_scale)
    if pre_clicked then
      params.set_norm(track, fx, map.pre, pre_on and 0 or 1)
    end

    local label_col = color_u32(0.92, 0.88, 0.78, 0.9)
    draw_label(ctx, dl, 'INPUT', x0 + 140 * draw_scale, y0 + 30 * draw_scale, label_col)
    draw_label(ctx, dl, 'OUTPUT', x0 + 134 * draw_scale, y0 + 230 * draw_scale, label_col)
    draw_label(ctx, dl, 'LOW', x0 + 40 * draw_scale, y0 + 255 * draw_scale, label_col)
    draw_label(ctx, dl, 'HIGH', x0 + 262 * draw_scale, y0 + 255 * draw_scale, label_col)
    draw_label(ctx, dl, 'DIST', dist_x + 6 * draw_scale, dist_y + 66 * draw_scale, label_col)
    draw_label(ctx, dl, 'PRE', pre_x + 10 * draw_scale, pre_y + 66 * draw_scale, label_col)

    local vu_in = params.get_norm(track, fx, map.in_vu)
    local vu_in_pk = params.get_norm(track, fx, map.in_peak)
    local vu_out = params.get_norm(track, fx, map.out_vu)
    local vu_out_pk = params.get_norm(track, fx, map.out_peak)

    local vu_x = x0 + 28 * draw_scale
    local vu_w = 294 * draw_scale
    local vu_h = 19 * draw_scale
    draw_vu(dl, vu_x, y0 + 167 * draw_scale, vu_w, vu_h, vu_in, vu_in_pk)
    draw_vu(dl, vu_x, y0 + 197 * draw_scale, vu_w, vu_h, vu_out, vu_out_pk)

    local clip_on = params.get_norm(track, fx, map.clip) > 0.5
    local led_x = x0 + 243 * draw_scale
    local led_y = y0 + 267 * draw_scale
    local led_w = 18 * draw_scale
    local led_h = 18 * draw_scale
    local led_col = clip_on and color_u32(0.95, 0.25, 0.25, 1.0) or color_u32(0.25, 0.10, 0.10, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, led_x, led_y, led_x + led_w, led_y + led_h, led_col, 4 * draw_scale)
    reaper.ImGui_DrawList_AddRect(dl, led_x, led_y, led_x + led_w, led_y + led_h, color_u32(0, 0, 0, 0.7), 4 * draw_scale, 0, 1.0)

    compat.set_cursor_screen_pos(ctx, x0, y0)
    if reaper.ImGui_Dummy then reaper.ImGui_Dummy(ctx, panel_w, panel_h) end
  end)
end

return panel
