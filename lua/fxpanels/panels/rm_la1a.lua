local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

local panel = {}

panel.meta = { win_w = 840, win_h = 320, scale_mult = 1.0 }

local BASE_W = 800
local BASE_H = 237

local param_cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function panel_scale(ctx, state)
  local scale = (state and (state.ui_scale or state.scale)) or 1.0
  scale = scale * (panel.meta.scale_mult or 1.0)
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
    gain = { patterns = { 'output', 'gain' }, default = 2 },
    threshold = { patterns = { 'threshold' }, default = 6 },
    mode = { patterns = { 'mode', 'compress', 'limit' }, default = 1 },
    sidechain = { patterns = { 'side chain', 'sidechain' }, default = 4 },
    gr = { patterns = { 'telemetry: gr', 'gr' }, default = 13 },
  }, param_cache)
end

local function color_u32(r, g, b, a)
  return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
end

local KNOB_ANG_MIN = math.rad(225)
local KNOB_ANG_MAX = math.rad(315)

local function draw_label(ctx, dl, text, x, y, col)
  if reaper.ImGui_DrawList_AddText then
    reaper.ImGui_DrawList_AddText(dl, x, y, col, text)
  else
    compat.set_cursor_screen_pos(ctx, x, y)
    reaper.ImGui_Text(ctx, text)
  end
end

local function draw_dial_face(dl, cx, cy, r, scale)
  local base = color_u32(0.17, 0.18, 0.20, 1.0)
  local inner = color_u32(0.10, 0.10, 0.12, 1.0)
  local rim = color_u32(0, 0, 0, 0.6)
  local tick = color_u32(0.85, 0.82, 0.72, 0.45)

  reaper.ImGui_DrawList_AddCircleFilled(dl, cx, cy, r, base)
  reaper.ImGui_DrawList_AddCircleFilled(dl, cx, cy, r * 0.82, inner)
  reaper.ImGui_DrawList_AddCircle(dl, cx, cy, r, rim, 0, 1.6 * scale)
  reaper.ImGui_DrawList_AddCircle(dl, cx, cy, r * 0.82, rim, 0, 1.0 * scale)

  local steps = 11
  for i = 0, steps - 1 do
    local t = i / (steps - 1)
    local ang = KNOB_ANG_MIN + (KNOB_ANG_MAX - KNOB_ANG_MIN) * t
    local len = (i == 0 or i == steps - 1) and 0.18 or 0.12
    local x1 = cx + math.cos(ang) * (r * 0.78)
    local y1 = cy + math.sin(ang) * (r * 0.78)
    local x2 = cx + math.cos(ang) * (r * (0.78 + len))
    local y2 = cy + math.sin(ang) * (r * (0.78 + len))
    reaper.ImGui_DrawList_AddLine(dl, x1, y1, x2, y2, tick, 1.2 * scale)
  end
end

local function knob_at(ctx, track, fx, ui, x, y, size, param, scale, id, invert)
  local v = params.get_norm(track, fx, param)
  local dv = invert and (1 - v) or v
  compat.set_cursor_screen_pos(ctx, x, y)
  local changed, nv = ui.knob_norm(ctx, id, dv, scale, size)
  if changed then
    local out = invert and (1 - nv) or nv
    params.set_norm(track, fx, param, out)
    v = out
  end
  return v
end

local function knob_with_dial(ctx, dl, track, fx, ui, x, y, size, param, scale, id, invert)
  local s = size * scale
  local cx = x + s * 0.5
  local cy = y + s * 0.5
  draw_dial_face(dl, cx, cy, s * 0.56, scale)
  return knob_at(ctx, track, fx, ui, x, y, size, param, scale, id, invert)
end

local function draw_switch(ctx, dl, label, x, y, w, h, active, scale)
  compat.set_cursor_screen_pos(ctx, x, y)
  local clicked = reaper.ImGui_InvisibleButton(ctx, '##' .. label .. ':' .. tostring(x) .. ':' .. tostring(y), w, h)
  local hovered = reaper.ImGui_IsItemHovered and reaper.ImGui_IsItemHovered(ctx)
  local bg = active and color_u32(0.95, 0.78, 0.28, 1.0) or color_u32(0.20, 0.20, 0.22, 1.0)
  local bd = hovered and color_u32(1, 1, 1, 0.35) or color_u32(0, 0, 0, 0.6)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 6 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 6 * scale, 0, 1.0)
  return clicked
end

local function angle_from_gr(gr)
  local g = compat.clamp(gr or 0, 0, 24)
  local t = (g / 24) ^ 0.65
  local a0 = 25
  local a1 = -72
  return a0 + (a1 - a0) * t
end

local function draw_needle(dl, cx, cy, len, angle_deg, scale)
  local ang = math.rad(angle_deg)
  local x2 = cx + math.cos(ang) * len
  local y2 = cy + math.sin(ang) * len
  reaper.ImGui_DrawList_AddLine(dl, cx, cy, x2, y2, color_u32(0.1, 0.1, 0.1, 0.9), 2.0 * scale)
  reaper.ImGui_DrawList_AddCircleFilled(dl, cx, cy, 4 * scale, color_u32(0.1, 0.1, 0.1, 0.9))
end

function panel.render(ctx, track, fx, ui, state)
  if not (compat.has_drawlist() and reaper.ImGui_InvisibleButton) then
    reaper.ImGui_Text(ctx, 'RM_LA1A')
    local map = map_params(track, fx)
    local function knob(label, param)
      local v = params.get_norm(track, fx, param)
      local fmt = params.get_formatted(track, fx, param)
      local changed, nv = ui.knob_norm(ctx, '##' .. label, v, 1.0, 60, label, fmt)
      if changed then params.set_norm(track, fx, param, nv) end
    end
    knob('Gain', map.gain)
    knob('Peak Reduction', map.threshold)
    local mode = params.get_norm(track, fx, map.mode)
    local changed, on = ui.toggle(ctx, 'Limit', mode > 0.5, 1.0)
    if changed then params.set_norm(track, fx, map.mode, on and 1 or 0) end
    local sc = params.get_norm(track, fx, map.sidechain)
    changed, on = ui.toggle(ctx, 'Sidechain', sc > 0.5, 1.0)
    if changed then params.set_norm(track, fx, map.sidechain, on and 1 or 0) end
    return
  end

  local draw_scale, panel_w, panel_h = panel_scale(ctx, state)
  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local x0, y0 = compat.get_cursor_screen_pos(ctx)

  local bg = color_u32(0.14, 0.13, 0.12, 1.0)
  local bd = color_u32(0, 0, 0, 0.7)
  reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + panel_w, y0 + panel_h, bg, 10 * draw_scale)
  reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + panel_h, bd, 10 * draw_scale, 0, 1.0)

  local map = map_params(track, fx)

  knob_with_dial(ctx, dl, track, fx, ui, x0 + 165 * draw_scale, y0 + 130 * draw_scale, 70, map.gain, draw_scale, '##la1a_gain', false)
  knob_with_dial(ctx, dl, track, fx, ui, x0 + 565 * draw_scale, y0 + 130 * draw_scale, 70, map.threshold, draw_scale, '##la1a_pr', true)

  local mode_on = params.get_norm(track, fx, map.mode) > 0.5
  local mode_clicked = draw_switch(ctx, dl, 'mode', x0 + 55 * draw_scale, y0 + 130 * draw_scale, 48 * draw_scale, 60 * draw_scale, mode_on, draw_scale)
  if mode_clicked then
    params.set_norm(track, fx, map.mode, mode_on and 0 or 1)
  end

  local sc_on = params.get_norm(track, fx, map.sidechain) > 0.5
  local sc_clicked = draw_switch(ctx, dl, 'sc', x0 + 665 * draw_scale, y0 + 90 * draw_scale, 48 * draw_scale, 60 * draw_scale, sc_on, draw_scale)
  if sc_clicked then
    params.set_norm(track, fx, map.sidechain, sc_on and 0 or 1)
  end

  local gr_raw = select(1, params.get_raw(track, fx, map.gr))
  local angle = angle_from_gr(gr_raw)
  local pivot_x = x0 + 385 * draw_scale
  local pivot_y = y0 + (200 * (237 / 238)) * draw_scale
  draw_needle(dl, pivot_x, pivot_y, 105 * draw_scale, angle, draw_scale)

  draw_label(ctx, dl, 'GAIN', x0 + 178 * draw_scale, y0 + 110 * draw_scale, color_u32(0.9, 0.85, 0.7, 0.8))
  draw_label(ctx, dl, 'PEAK', x0 + 570 * draw_scale, y0 + 110 * draw_scale, color_u32(0.9, 0.85, 0.7, 0.8))
  draw_label(ctx, dl, mode_on and 'LIMIT' or 'COMP', x0 + 45 * draw_scale, y0 + 195 * draw_scale, color_u32(0.9, 0.85, 0.7, 0.8))
  draw_label(ctx, dl, sc_on and 'SC' or 'MAIN', x0 + 665 * draw_scale, y0 + 70 * draw_scale, color_u32(0.9, 0.85, 0.7, 0.8))

  compat.set_cursor_screen_pos(ctx, x0, y0)
  if reaper.ImGui_Dummy then reaper.ImGui_Dummy(ctx, panel_w, panel_h) end
end

function panel.clear_cache()
  for k in pairs(param_cache) do
    param_cache[k] = nil
  end
end

return panel
