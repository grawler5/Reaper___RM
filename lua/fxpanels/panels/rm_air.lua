local params = require('fxpanels.params')
local theme = require('fxpanels.theme')
local compat = require('fxpanels.compat')

local panel = {}

panel.meta = { win_w = 860, win_h = 520, scale_mult = 1.5 }

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

  local cx = x + w * 0.3
  local cy = y + h * 0.25
  local radius = math.min(w, h) * 0.55
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy, radius, rgba_pack(colors.panelRadial))
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy, radius * 0.62, rgba_pack(colors.panelRadialMid))
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy, radius * 0.4, rgba_pack(colors.panelRadialEdge))
end

local function draw_knob(ctx, draw_list, x, y, size, scale, metrics, colors, value, value_text, label)
  local radius = size * 0.5
  local cx, cy = x + radius, y + radius
  local border = rgba_pack(colors.knobOuterBorder)
  local top = rgba_pack(colors.knobOuterTop)
  local bot = rgba_pack(colors.knobOuterBottom)
  local inset = rgba_pack(colors.knobOuterInset)
  local shadow = rgba_pack(colors.knobOuterShadow)

  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy + radius * 0.12, radius * 0.98, shadow)
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy, radius, bot)
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy - radius * 0.08, radius * 0.92, top)
  reaper.ImGui_DrawList_AddCircle(draw_list, cx, cy, radius, border, 64, 1 * scale)
  reaper.ImGui_DrawList_AddCircle(draw_list, cx, cy - radius * 0.2, radius * 0.88, inset, 64, 1 * scale)

  local inner_r = radius - metrics.knobInset * scale
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy, inner_r, rgba_pack(colors.knobInnerEdge))
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy - inner_r * 0.08, inner_r * 0.92, rgba_pack(colors.knobInnerMid))
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy - inner_r * 0.16, inner_r * 0.78, rgba_pack(colors.knobInnerRadial))
  reaper.ImGui_DrawList_AddCircle(draw_list, cx, cy, inner_r, rgba_pack(colors.knobInnerBorder), 64, 1 * scale)

  local v = clamp01(value)
  local ang_min = math.rad(-135)
  local ang_max = math.rad(135)
  local ang = ang_min + (ang_max - ang_min) * v
  local arc_r = radius - metrics.arcPadding * scale
  if reaper.ImGui_DrawList_PathArcTo then
    reaper.ImGui_DrawList_PathArcTo(draw_list, cx, cy, arc_r, ang_min, ang)
    reaper.ImGui_DrawList_PathStroke(draw_list, rgba_pack(colors.arc), 0, metrics.arcWidth * scale)
  end

  local px = cx + math.cos(ang) * (inner_r * 0.7)
  local py = cy + math.sin(ang) * (inner_r * 0.7)
  reaper.ImGui_DrawList_AddLine(draw_list, cx, cy, px, py, rgba_pack(colors.knobIndicator), 3 * scale)

  if value_text then
    local text_w, text_h = reaper.ImGui_CalcTextSize(ctx, value_text)
    reaper.ImGui_DrawList_AddText(draw_list, cx - text_w * 0.5, cy - text_h * 0.5, rgba_pack(colors.text), value_text)
  end

  if label then
    local label_w, label_h = reaper.ImGui_CalcTextSize(ctx, label)
    reaper.ImGui_DrawList_AddText(draw_list, cx - label_w * 0.5, y + size + metrics.labelGap * scale, rgba_pack(colors.label), label)
  end
end

local function knob_control(ctx, id, x, y, size, value)
  reaper.ImGui_SetCursorScreenPos(ctx, x, y)
  reaper.ImGui_InvisibleButton(ctx, id, size, size)
  if reaper.ImGui_IsItemActive(ctx) then
    local dx, dy = reaper.ImGui_GetMouseDelta(ctx)
    if dx ~= 0 or dy ~= 0 then
      local nv = value - dy * 0.005 - dx * 0.001
      return true, compat.clamp(nv, 0, 1)
    end
  end
  return false, value
end

local function draw_link(ctx, draw_list, x, y, w, h, scale, metrics, colors, label, active)
  reaper.ImGui_SetCursorScreenPos(ctx, x, y)
  reaper.ImGui_InvisibleButton(ctx, '##air_link', w, h)
  local pressed = reaper.ImGui_IsItemClicked(ctx)

  local bg = active and colors.linkOnBg or colors.linkBg
  local border = active and colors.linkOnBorder or colors.linkBorder
  local text = active and colors.linkOnText or colors.linkText
  local inset = active and colors.linkInset or colors.linkInset

  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + w, y + h, rgba_pack(bg), metrics.linkRadius * scale)
  reaper.ImGui_DrawList_AddRect(draw_list, x, y, x + w, y + h, rgba_pack(border), metrics.linkRadius * scale, 0, 1 * scale)
  reaper.ImGui_DrawList_AddLine(draw_list, x + w * 0.2, y + 1 * scale, x + w * 0.8, y + 1 * scale, rgba_pack(inset), 1 * scale)
  if active then
    reaper.ImGui_DrawList_AddRect(draw_list, x - 2 * scale, y - 2 * scale, x + w + 2 * scale, y + h + 2 * scale, rgba_pack(colors.linkOnGlow), metrics.linkRadius * scale, 0, 2 * scale)
  end
  local text_w, text_h = reaper.ImGui_CalcTextSize(ctx, label)
  reaper.ImGui_DrawList_AddText(draw_list, x + (w - text_w) * 0.5, y + (h - text_h) * 0.5, rgba_pack(text), label)

  return pressed
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)
  local tokens = theme.tokens().panels.rmAir
  local metrics = tokens.metrics
  local colors = tokens.colors

  local map = params.build_map(track, fx, {
    mid = { patterns = { 'mid air' } },
    high = { patterns = { 'high air' } },
    trim = { patterns = { 'trim' } },
    link = { patterns = { 'link' } },
  }, cache, 'rm_air')

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

  local col_w = (content_w - metrics.gapCol * scale * 2)
  local col_w1 = col_w * (1 / 3)
  local col_w2 = col_w1
  local col_w3 = col_w1
  local row_h = (content_h - metrics.gapRow * scale)
  local row_h1 = row_h * 0.6
  local row_h2 = row_h - row_h1

  local knob_size = metrics.knobSize * scale
  local knob_small = metrics.knobSmall * scale

  local mid_x = content_x
  local mid_y = content_y
  local high_x = content_x + col_w1 + metrics.gapCol * scale + col_w2 + metrics.gapCol * scale
  local high_y = content_y
  local link_x = content_x + col_w1 + metrics.gapCol * scale
  local link_y = content_y + (row_h1 - metrics.linkPadY * 2 * scale) * 0.5

  local trim_x = content_x + col_w1 + metrics.gapCol * scale + col_w2 + metrics.gapCol * scale
  local trim_y = content_y + row_h1 + metrics.gapRow * scale

  local mid_val = map.mid and clamp01(params.get_norm(track, fx, map.mid)) or 0
  local high_val = map.high and clamp01(params.get_norm(track, fx, map.high)) or 0
  local trim_val = map.trim and clamp01(params.get_norm(track, fx, map.trim)) or 0

  local mid_fmt = map.mid and params.get_formatted(track, fx, map.mid) or '0'
  local high_fmt = map.high and params.get_formatted(track, fx, map.high) or '0'
  local trim_fmt = map.trim and params.get_formatted(track, fx, map.trim) or '0'

  draw_knob(ctx, draw_list, mid_x + (col_w1 - knob_size) * 0.5, mid_y + (row_h1 - knob_size) * 0.5, knob_size, scale, metrics, colors, mid_val, mid_fmt, 'MID')
  draw_knob(ctx, draw_list, high_x + (col_w3 - knob_size) * 0.5, high_y + (row_h1 - knob_size) * 0.5, knob_size, scale, metrics, colors, high_val, high_fmt, 'HIGH')
  draw_knob(ctx, draw_list, trim_x + (col_w3 - knob_small) * 0.5, trim_y + (row_h2 - knob_small) * 0.5, knob_small, scale, metrics, colors, trim_val, trim_fmt, 'TRIM')

  local changed, nv = knob_control(ctx, '##air_mid', mid_x + (col_w1 - knob_size) * 0.5, mid_y + (row_h1 - knob_size) * 0.5, knob_size, mid_val)
  if changed and map.mid then params.set_norm(track, fx, map.mid, nv) end
  local changed2, nv2 = knob_control(ctx, '##air_high', high_x + (col_w3 - knob_size) * 0.5, high_y + (row_h1 - knob_size) * 0.5, knob_size, high_val)
  if changed2 and map.high then params.set_norm(track, fx, map.high, nv2) end
  local changed3, nv3 = knob_control(ctx, '##air_trim', trim_x + (col_w3 - knob_small) * 0.5, trim_y + (row_h2 - knob_small) * 0.5, knob_small, trim_val)
  if changed3 and map.trim then params.set_norm(track, fx, map.trim, nv3) end

  local link_w = metrics.linkPadX * 2 * scale + 60 * scale
  local link_h = metrics.linkPadY * 2 * scale
  local link_state = map.link and (params.get_norm(track, fx, map.link) >= 0.5) or false
  local pressed = draw_link(ctx, draw_list, link_x + (col_w2 - link_w) * 0.5, link_y, link_w, link_h, scale, metrics, colors, 'LINK', link_state)
  if pressed and map.link then
    params.set_norm(track, fx, map.link, link_state and 0 or 1)
  end

  reaper.ImGui_SetCursorScreenPos(ctx, x0, y0 + panel_h)
  reaper.ImGui_Dummy(ctx, panel_w, panel_h)
end

return panel
