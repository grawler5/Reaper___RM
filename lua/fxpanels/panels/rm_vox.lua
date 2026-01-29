local params = require('fxpanels.params')
local theme = require('fxpanels.theme')
local compat = require('fxpanels.compat')

local panel = {}

panel.meta = { win_w = 480, win_h = 520, scale_mult = 1.0 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function pack(r, g, b, a)
  if reaper.ImGui_ColorConvertDouble4ToU32 then
    return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
  end
  return r, g, b, a
end

local function rgba(token)
  if type(token) == 'string' then
    return theme.rgba(token)
  end
  if type(token) == 'table' then
    local r, g, b, a = token[1], token[2], token[3], token[4]
    if r > 1 or g > 1 or b > 1 then
      r, g, b = r / 255, g / 255, b / 255
    end
    return r or 0, g or 0, b or 0, a or 1
  end
  return 0, 0, 0, 1
end

local function rgba_pack(token)
  return pack(rgba(token))
end

local function draw_shadow(draw_list, x, y, w, h, scale, metrics, colors)
  local blur = metrics.shadowBlur * scale
  local offset_y = metrics.shadowOffsetY * scale
  local spread = blur * 0.35
  local sx = x - spread
  local sy = y - spread + offset_y
  local sw = w + spread * 2
  local sh = h + spread * 2
  reaper.ImGui_DrawList_AddRectFilled(draw_list, sx, sy, sx + sw, sy + sh, rgba_pack(colors.panelShadow), metrics.radius * scale)
end

local function draw_panel(draw_list, x, y, w, h, scale, metrics, colors)
  if reaper.ImGui_DrawList_AddRectFilledMultiColor then
    reaper.ImGui_DrawList_AddRectFilledMultiColor(
      draw_list,
      x, y, x + w, y + h,
      rgba_pack(colors.panelGradTop),
      rgba_pack(colors.panelGradTop),
      rgba_pack(colors.panelGradBottom),
      rgba_pack(colors.panelGradBottom)
    )
  else
    reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + w, y + h, rgba_pack(colors.panelGradTop), metrics.radius * scale)
  end
  reaper.ImGui_DrawList_AddRect(draw_list, x, y, x + w, y + h, rgba_pack(colors.panelBorder), metrics.radius * scale, 0, 1 * scale)
  reaper.ImGui_DrawList_AddLine(draw_list, x + metrics.radius * 0.4 * scale, y + metrics.insetOffsetY * scale,
    x + w - metrics.radius * 0.4 * scale, y + metrics.insetOffsetY * scale, rgba_pack(colors.panelInset), 1 * scale)
end

local function draw_text(draw_list, x, y, color_token, text)
  reaper.ImGui_DrawList_AddText(draw_list, x, y, rgba_pack(color_token), text)
end

local function draw_track(draw_list, x, y, w, h, scale, colors, radius)
  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + w, y + h, rgba_pack(colors.trackBg), radius)
  reaper.ImGui_DrawList_AddRect(draw_list, x, y, x + w, y + h, rgba_pack(colors.trackBorder), radius, 0, 1 * scale)
  reaper.ImGui_DrawList_AddRect(draw_list, x + 1 * scale, y + 1 * scale, x + w - 1 * scale, y + h - 1 * scale,
    rgba_pack(colors.trackInset), radius - 1 * scale, 0, 1 * scale)
end

local function draw_meter(draw_list, x, y, w, h, scale, colors, value, gradient)
  local fill_h = h * clamp01(value)
  local y0 = y + (h - fill_h)
  local g1, g2, g3 = gradient[1], gradient[2], gradient[3]
  if reaper.ImGui_DrawList_AddRectFilledMultiColor then
    reaper.ImGui_DrawList_AddRectFilledMultiColor(
      draw_list,
      x, y0, x + w, y + h,
      rgba_pack(g1), rgba_pack(g1), rgba_pack(g3), rgba_pack(g3)
    )
  else
    reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y0, x + w, y + h, rgba_pack(g2))
  end
end

local function draw_fader(draw_list, x, y, w, h, scale, colors, value, thumb_w, thumb_h)
  local fill_h = h * clamp01(value)
  local y0 = y + (h - fill_h)
  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y0, x + w, y + h, rgba_pack(colors.faderFill), w * 0.5)

  local thumb_x = x + (w - thumb_w) * 0.5
  local thumb_y = y0 - thumb_h * 0.5
  reaper.ImGui_DrawList_AddRectFilled(draw_list, thumb_x, thumb_y, thumb_x + thumb_w, thumb_y + thumb_h,
    rgba_pack(colors.thumbBg), thumb_h * 0.5)
  reaper.ImGui_DrawList_AddRect(draw_list, thumb_x, thumb_y, thumb_x + thumb_w, thumb_y + thumb_h,
    rgba_pack(colors.thumbBorder), thumb_h * 0.5, 0, 1 * scale)
end

local function handle_fader(ctx, id, x, y, w, h, value)
  reaper.ImGui_SetCursorScreenPos(ctx, x, y)
  reaper.ImGui_InvisibleButton(ctx, id, w, h)
  if reaper.ImGui_IsItemActive(ctx) then
    local _, my = reaper.ImGui_GetMousePos(ctx)
    local t = 1 - ((my - y) / h)
    value = compat.clamp(t, 0, 1)
    return true, value
  end
  return false, value
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)
  local tokens = theme.tokens().panels.rmVox
  local metrics = tokens.metrics
  local colors = tokens.colors

  local map = params.build_map(track, fx, {
    gate = { patterns = { 'gate' } },
    comp = { patterns = { 'comp' } },
    gain = { patterns = { 'gain' } },
    in_peak = { patterns = { 'telemetry', 'in peak' } },
    gr = { patterns = { 'telemetry', 'gr' } },
    out_peak = { patterns = { 'telemetry', 'out peak' } },
  }, cache, 'rm_vox')

  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  local panel_w = math.min(avail_w, metrics.maxW * scale)
  local panel_h = math.min(avail_h, metrics.maxH * scale)
  local x0, y0 = reaper.ImGui_GetCursorScreenPos(ctx)

  local offset_x = (avail_w - panel_w) * 0.5
  local offset_y = (avail_h - panel_h) * 0.5
  if offset_x > 0 then reaper.ImGui_Dummy(ctx, offset_x, 0) end
  if offset_y > 0 then
    reaper.ImGui_Dummy(ctx, 0, offset_y)
    x0, y0 = reaper.ImGui_GetCursorScreenPos(ctx)
  end

  local draw_list = reaper.ImGui_GetWindowDrawList(ctx)
  draw_shadow(draw_list, x0, y0, panel_w, panel_h, scale, metrics, colors)
  draw_panel(draw_list, x0, y0, panel_w, panel_h, scale, metrics, colors)

  local pad_x = metrics.padX * scale
  local pad_y = metrics.padY * scale
  local content_x = x0 + pad_x
  local content_y = y0 + pad_y
  local content_w = panel_w - pad_x * 2
  local content_h = panel_h - pad_y * 2

  local header_h = metrics.headerH * scale
  draw_text(draw_list, content_x, content_y, colors.logo, 'RM Vox')
  draw_text(draw_list, content_x + metrics.logoSubOffsetX * scale, content_y + metrics.logoSubOffsetY * scale, colors.sub, 'channel')

  local grid_y = content_y + header_h + metrics.gap * scale
  local grid_h = content_h - header_h - metrics.gap * scale
  local gap = metrics.gridGap * scale
  local total_fr = 3.2
  local col_w1 = (content_w - gap * 2) * (1 / total_fr)
  local col_w2 = (content_w - gap * 2) * (1.2 / total_fr)
  local col_w3 = col_w1

  local function column(x, w, title, meter_val, fader_val, track_w, track_h, track_radius, meter_gradient, thumb_w)
    local title_y = grid_y
    local text_w = ({ reaper.ImGui_CalcTextSize(ctx, title) })[1] or 0
    draw_text(draw_list, x + (w - text_w) * 0.5, title_y, colors.colTitle, title)

    local track_x = x + (w - track_w) * 0.5
    local track_y = title_y + metrics.titleToTrack * scale

    draw_track(draw_list, track_x, track_y, track_w, track_h, scale, colors, track_radius * scale)

    local meter_x = track_x
    local meter_y = track_y
    draw_meter(draw_list, meter_x, meter_y, track_w, track_h, scale, colors, meter_val or 0, meter_gradient)

    draw_fader(draw_list, track_x, track_y, track_w, track_h, scale, colors, fader_val or 0, thumb_w, metrics.thumbH * scale)

    local changed, nv = handle_fader(ctx, string.format('##vox_%s', title), track_x, track_y, track_w, track_h, fader_val or 0)
    return changed, nv, track_y + track_h + metrics.valueGap * scale
  end

  local gate_val = map.gate and clamp01(params.get_norm(track, fx, map.gate)) or 0
  local comp_val = map.comp and clamp01(params.get_norm(track, fx, map.comp)) or 0
  local gain_val = map.gain and clamp01(params.get_norm(track, fx, map.gain)) or 0

  local gate_meter = map.in_peak and clamp01(params.get_norm(track, fx, map.in_peak)) or 0
  local comp_meter = map.gr and clamp01(params.get_norm(track, fx, map.gr)) or 0
  local gain_meter = map.out_peak and clamp01(params.get_norm(track, fx, map.out_peak)) or 0

  local col1_x = content_x
  local col2_x = content_x + col_w1 + gap
  local col3_x = content_x + col_w1 + col_w2 + gap * 2

  local changed, nv = column(col1_x, col_w1, 'Gate', gate_meter, gate_val,
    metrics.trackW * scale, metrics.trackH * scale, metrics.trackRadius, colors.meterFill, metrics.thumbW * scale)
  if changed and map.gate then params.set_norm(track, fx, map.gate, nv) end

  local changed2, nv2 = column(col2_x, col_w2, 'Comp', comp_meter, comp_val,
    metrics.trackWideW * scale, metrics.trackWideH * scale, metrics.trackRadiusWide, colors.meterFillComp, metrics.thumbWComp * scale)
  if changed2 and map.comp then params.set_norm(track, fx, map.comp, nv2) end

  local changed3, nv3 = column(col3_x, col_w3, 'Gain', gain_meter, gain_val,
    metrics.trackNarrowW * scale, metrics.trackH * scale, metrics.trackRadius, colors.meterFillGain, metrics.thumbW * scale)
  if changed3 and map.gain then params.set_norm(track, fx, map.gain, nv3) end

  reaper.ImGui_SetCursorScreenPos(ctx, x0, y0 + panel_h)
  reaper.ImGui_Dummy(ctx, panel_w, panel_h)
end

return panel
