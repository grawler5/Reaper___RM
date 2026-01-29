local theme = require('fxpanels.theme')
local compat = require('fxpanels.compat')

local controls = {}

local function pack(r, g, b, a)
  if reaper.ImGui_ColorConvertDouble4ToU32 then
    return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
  end
  return r, g, b, a
end

local function color(hex, alpha)
  return theme.rgba(hex, alpha)
end

function controls.toggle(ctx, id, value, scale, opts)
  local m = theme.metrics(scale)
  local r = theme.radii(scale)
  local c = theme.colors()
  local height = (opts and opts.height) or m.control_h
  local width = (opts and opts.width) or (height * 1.8)
  local radius = (opts and opts.radius) or r.md

  local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
  reaper.ImGui_InvisibleButton(ctx, id, width, height)
  local hovered = reaper.ImGui_IsItemHovered(ctx)
  local active = reaper.ImGui_IsItemActive(ctx)
  local pressed = reaper.ImGui_IsItemClicked(ctx)

  local base = value and c.accent or c.elevated
  if hovered then
    base = value and c.accentHover or c.slot
  end
  local fill_r, fill_g, fill_b, fill_a = color(base)
  local border_r, border_g, border_b, border_a = color(c.border)

  local draw_list = reaper.ImGui_GetWindowDrawList(ctx)
  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + width, y + height,
    pack(fill_r, fill_g, fill_b, fill_a), radius)
  reaper.ImGui_DrawList_AddRect(draw_list, x, y, x + width, y + height,
    pack(border_r, border_g, border_b, border_a), radius, 0, scale or 1.0)

  local knob_d = height - (m.item_space_y or 0)
  local knob_r = knob_d * 0.5
  local knob_x = value and (x + width - knob_d) or x
  local knob_y = y + (height - knob_d) * 0.5
  local knob_r_col, knob_g_col, knob_b_col, knob_a_col = color(c.surface)
  if active then
    knob_r_col, knob_g_col, knob_b_col, knob_a_col = color(c.elevated)
  end
  reaper.ImGui_DrawList_AddCircleFilled(draw_list, knob_x + knob_r, knob_y + knob_r,
    knob_r, pack(knob_r_col, knob_g_col, knob_b_col, knob_a_col))

  if pressed then
    value = not value
  end

  return pressed, value
end

function controls.slider(ctx, id, value, scale, opts)
  local m = theme.metrics(scale)
  local r = theme.radii(scale)
  local c = theme.colors()
  local width = (opts and opts.width) or (m.control_w * 6)
  local height = (opts and opts.height) or m.control_h
  local radius = (opts and opts.radius) or r.md

  local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
  reaper.ImGui_InvisibleButton(ctx, id, width, height)
  local hovered = reaper.ImGui_IsItemHovered(ctx)
  local active = reaper.ImGui_IsItemActive(ctx)
  local pressed = reaper.ImGui_IsItemClicked(ctx)
  local draw_list = reaper.ImGui_GetWindowDrawList(ctx)

  local track_y = y + (height - m.slider_track_h) * 0.5
  local track_r, track_g, track_b, track_a = color(c.elevated)
  local fill_r, fill_g, fill_b, fill_a = color(hovered and c.accentHover or c.accent)
  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, track_y, x + width, track_y + m.slider_track_h,
    pack(track_r, track_g, track_b, track_a), radius)

  local t = compat.clamp(value or 0, 0, 1)
  local fill_w = width * t
  if fill_w > 0 then
    reaper.ImGui_DrawList_AddRectFilled(draw_list, x, track_y, x + fill_w, track_y + m.slider_track_h,
      pack(fill_r, fill_g, fill_b, fill_a), radius)
  end

  local thumb = m.slider_thumb
  local thumb_x = x + fill_w - thumb * 0.5
  local thumb_y = y + (height - thumb) * 0.5
  local thumb_r, thumb_g, thumb_b, thumb_a = color(c.surface)
  if active then
    thumb_r, thumb_g, thumb_b, thumb_a = color(c.slot)
  end
  local border_r, border_g, border_b, border_a = color(c.border)
  reaper.ImGui_DrawList_AddRectFilled(draw_list, thumb_x, thumb_y, thumb_x + thumb, thumb_y + thumb,
    pack(thumb_r, thumb_g, thumb_b, thumb_a), m.control_radius)
  reaper.ImGui_DrawList_AddRect(draw_list, thumb_x, thumb_y, thumb_x + thumb, thumb_y + thumb,
    pack(border_r, border_g, border_b, border_a), m.control_radius, 0, scale or 1.0)

  if active then
    local mx, _ = reaper.ImGui_GetMousePos(ctx)
    local nv = (mx - x) / width
    value = compat.clamp(nv, 0, 1)
  end

  return pressed or active, value
end

function controls.knob(ctx, id, value, scale, opts)
  local m = theme.metrics(scale)
  local c = theme.colors()
  local size = (opts and opts.size) or m.knob_size
  local arc_w = (opts and opts.arc) or m.knob_arc
  local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
  local draw_list = reaper.ImGui_GetWindowDrawList(ctx)

  reaper.ImGui_InvisibleButton(ctx, id, size, size)
  local active = reaper.ImGui_IsItemActive(ctx)

  local cx, cy = x + size * 0.5, y + size * 0.5
  local radius = size * 0.42
  local bg_r, bg_g, bg_b, bg_a = color(c.elevated)
  local border_r, border_g, border_b, border_a = color(c.border)
  local fg_r, fg_g, fg_b, fg_a = color(c.accent)

  reaper.ImGui_DrawList_AddCircleFilled(draw_list, cx, cy, radius, pack(bg_r, bg_g, bg_b, bg_a))
  reaper.ImGui_DrawList_AddCircle(draw_list, cx, cy, radius, pack(border_r, border_g, border_b, border_a), 32, scale or 1.0)

  local v = compat.clamp(value or 0, 0, 1)
  local ang_min = math.rad(225)
  local ang_max = math.rad(315)
  local ang = ang_min + (ang_max - ang_min) * v
  local px = cx + math.cos(ang) * (radius * 0.78)
  local py = cy + math.sin(ang) * (radius * 0.78)
  reaper.ImGui_DrawList_AddLine(draw_list, cx, cy, px, py, pack(fg_r, fg_g, fg_b, fg_a), arc_w)

  if active then
    local dx, dy = reaper.ImGui_GetMouseDelta(ctx)
    if dx ~= 0 or dy ~= 0 then
      local nv = v - dy * 0.005 - dx * 0.001
      value = compat.clamp(nv, 0, 1)
    end
  end

  return active, value
end

return controls
