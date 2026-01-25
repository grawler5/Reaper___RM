local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

local panel = {}

panel.meta = { win_w = 940, win_h = 300 }

local BASE_W = 906
local BASE_H = 213

local param_cache = {}
local last_ratio_cache = {}

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
    input = { patterns = { 'in gain', 'input' }, default = 5 },
    output = { patterns = { 'out gain', 'output' }, default = 1 },
    attack = { patterns = { 'attack' }, default = 2 },
    release = { patterns = { 'release' }, default = 3 },
    ratio = { patterns = { 'ratio' }, default = 0 },
    punch = { patterns = { 'punch' }, default = 6 },
    sc_key = { patterns = { 'sc key', 'sidechain' }, default = 7 },
    trick = { patterns = { 'trick' }, default = 8 },
    gr = { patterns = { 'gain reduction', 'gr' }, default = 4 },
  }, param_cache)
end

local function color_u32(r, g, b, a)
  return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
end

local KNOB_ANG_MIN = math.rad(210)
local KNOB_ANG_MAX = math.rad(330)

local function draw_label(ctx, dl, text, x, y, col)
  if reaper.ImGui_DrawList_AddText then
    reaper.ImGui_DrawList_AddText(dl, x, y, col, text)
  else
    compat.set_cursor_screen_pos(ctx, x, y)
    reaper.ImGui_Text(ctx, text)
  end
end

local function draw_dial_face(dl, cx, cy, r, scale)
  local base = color_u32(0.18, 0.19, 0.22, 1.0)
  local inner = color_u32(0.10, 0.10, 0.12, 1.0)
  local rim = color_u32(0, 0, 0, 0.6)
  local tick = color_u32(0.88, 0.88, 0.92, 0.42)

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

local function draw_rect_button(ctx, dl, id, x, y, w, h, active, scale)
  compat.set_cursor_screen_pos(ctx, x, y)
  local clicked = reaper.ImGui_InvisibleButton(ctx, id, w, h)
  local hovered = reaper.ImGui_IsItemHovered and reaper.ImGui_IsItemHovered(ctx)
  local bg = active and color_u32(0.92, 0.76, 0.34, 1.0) or color_u32(0.20, 0.20, 0.22, 1.0)
  local bd = hovered and color_u32(1, 1, 1, 0.35) or color_u32(0, 0, 0, 0.6)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 5 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 5 * scale, 0, 1.0)
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

local function fx_key(track, fx)
  local guid = reaper.GetTrackGUID and reaper.GetTrackGUID(track) or ''
  return tostring(guid) .. ':' .. tostring(fx)
end

function panel.render(ctx, track, fx, ui, state)
  if not (compat.has_drawlist() and reaper.ImGui_InvisibleButton) then
    reaper.ImGui_Text(ctx, 'RM_1175')
    local map = map_params(track, fx)
    local function knob(label, param)
      local v = params.get_norm(track, fx, param)
      local fmt = params.get_formatted(track, fx, param)
      local changed, nv = ui.knob_norm(ctx, '##' .. label, v, 1.0, 60, label, fmt)
      if changed then params.set_norm(track, fx, param, nv) end
    end
    knob('Input', map.input)
    knob('Output', map.output)
    knob('Attack', map.attack)
    knob('Release', map.release)
    local ratio_raw = params.get_raw(track, fx, map.ratio)
    local changed, nr = reaper.ImGui_SliderDouble(ctx, 'Ratio', ratio_raw, 0, 4)
    if changed then params.set_raw(track, fx, map.ratio, nr) end
    local punch = params.get_norm(track, fx, map.punch)
    local changed2, on = ui.toggle(ctx, 'Punch', punch > 0.5, 1.0)
    if changed2 then params.set_norm(track, fx, map.punch, on and 1 or 0) end
    return
  end

  local draw_scale, panel_w, panel_h = panel_scale(ctx, state)
  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local x0, y0 = compat.get_cursor_screen_pos(ctx)

  local bg = color_u32(0.13, 0.13, 0.14, 1.0)
  local bd = color_u32(0, 0, 0, 0.7)
  reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + panel_w, y0 + panel_h, bg, 10 * draw_scale)
  reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + panel_h, bd, 10 * draw_scale, 0, 1.0)

  local map = map_params(track, fx)

  knob_with_dial(ctx, dl, track, fx, ui, x0 + 80 * draw_scale, y0 + 60 * draw_scale, 100, map.input, draw_scale, '##1175_in', false)
  knob_with_dial(ctx, dl, track, fx, ui, x0 + 270 * draw_scale, y0 + 60 * draw_scale, 100, map.output, draw_scale, '##1175_out', false)
  knob_with_dial(ctx, dl, track, fx, ui, x0 + 460 * draw_scale, y0 + 53 * draw_scale, 40, map.attack, draw_scale, '##1175_att', true)
  knob_with_dial(ctx, dl, track, fx, ui, x0 + 460 * draw_scale, y0 + 133 * draw_scale, 40, map.release, draw_scale, '##1175_rel', true)

  local ratio_raw = select(1, params.get_raw(track, fx, map.ratio))
  local ratio_is_all = ratio_raw >= 3.5

  local ratio_positions = {
    { raw = 3, label = '20', x = 540, y = 40 },
    { raw = 2, label = '12', x = 540, y = 75 },
    { raw = 1, label = '8', x = 540, y = 110 },
    { raw = 0, label = '4', x = 540, y = 145 },
  }

  for _, btn in ipairs(ratio_positions) do
    local active = ratio_is_all or math.abs(ratio_raw - btn.raw) < 0.51
    local bx = x0 + btn.x * draw_scale
    local by = y0 + btn.y * draw_scale
    local clicked = draw_rect_button(ctx, dl, '##ratio_' .. btn.label, bx, by, 35 * draw_scale, 35 * draw_scale, active, draw_scale)
    if clicked then
      params.set_raw(track, fx, map.ratio, btn.raw)
    end
    draw_label(ctx, dl, btn.label, bx + 10 * draw_scale, by + 9 * draw_scale, color_u32(0.1, 0.1, 0.1, 1.0))
  end

  local key = fx_key(track, fx)
  local last_ratio = last_ratio_cache[key]

  local all_x = x0 + 820 * draw_scale
  local all_y = y0 + 145 * draw_scale
  local all_active = ratio_is_all
  local all_clicked = draw_rect_button(ctx, dl, '##ratio_all', all_x, all_y, 35 * draw_scale, 35 * draw_scale, all_active, draw_scale)
  if all_clicked then
    if not ratio_is_all then
      if ratio_raw <= 3 then last_ratio_cache[key] = ratio_raw end
      params.set_raw(track, fx, map.ratio, 4)
    else
      params.set_raw(track, fx, map.ratio, last_ratio or 0)
    end
  end
  draw_label(ctx, dl, 'ALL', all_x + 4 * draw_scale, all_y + 9 * draw_scale, color_u32(0.1, 0.1, 0.1, 1.0))

  local punch = params.get_norm(track, fx, map.punch) > 0.5
  local sc_key = params.get_norm(track, fx, map.sc_key) > 0.5
  local trick = params.get_norm(track, fx, map.trick) > 0.5

  local function opt_button(name, x, y, active, param)
    local bx = x0 + x * draw_scale
    local by = y0 + y * draw_scale
    local clicked = draw_rect_button(ctx, dl, '##' .. name, bx, by, 35 * draw_scale, 35 * draw_scale, active, draw_scale)
    if clicked then
      params.set_norm(track, fx, param, active and 0 or 1)
    end
    draw_label(ctx, dl, name, bx + 2 * draw_scale, by + 9 * draw_scale, color_u32(0.1, 0.1, 0.1, 1.0))
  end

  opt_button('P', 820, 40, punch, map.punch)
  opt_button('SC', 820, 75, sc_key, map.sc_key)
  opt_button('TR', 820, 110, trick, map.trick)

  local gr_raw = select(1, params.get_raw(track, fx, map.gr))
  local angle = angle_from_gr(gr_raw)
  local pivot_x = x0 + 700 * draw_scale
  local pivot_y = y0 + 147 * draw_scale
  draw_needle(dl, pivot_x, pivot_y, 78 * draw_scale, angle, draw_scale)

  draw_label(ctx, dl, 'IN', x0 + 110 * draw_scale, y0 + 30 * draw_scale, color_u32(0.9, 0.9, 0.9, 0.7))
  draw_label(ctx, dl, 'OUT', x0 + 295 * draw_scale, y0 + 30 * draw_scale, color_u32(0.9, 0.9, 0.9, 0.7))
  draw_label(ctx, dl, 'ATT', x0 + 450 * draw_scale, y0 + 30 * draw_scale, color_u32(0.9, 0.9, 0.9, 0.7))
  draw_label(ctx, dl, 'REL', x0 + 450 * draw_scale, y0 + 175 * draw_scale, color_u32(0.9, 0.9, 0.9, 0.7))

  compat.set_cursor_screen_pos(ctx, x0, y0)
  if reaper.ImGui_Dummy then reaper.ImGui_Dummy(ctx, panel_w, panel_h) end
end

return panel
