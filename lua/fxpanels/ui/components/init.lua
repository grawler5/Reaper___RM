local theme = require('fxpanels.theme')
local controls = require('fxpanels.ui.components.controls')

local components = {}

local function resolve_color(hex, alpha)
  return theme.rgba(hex, alpha)
end

local function pack(r, g, b, a)
  if reaper.ImGui_ColorConvertDouble4ToU32 then
    return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
  end
  return r, g, b, a
end

function components.draw_card(draw_list, x, y, w, h, scale, opts)
  local c = theme.colors()
  local r = theme.radii(scale)
  local radius = (opts and opts.radius) or r.lg
  local border = (opts and opts.border) or c.border
  local fill = (opts and opts.fill) or c.surface
  local fill_r, fill_g, fill_b, fill_a = resolve_color(fill)
  local border_r, border_g, border_b, border_a = resolve_color(border)
  local fill_u32 = pack(fill_r, fill_g, fill_b, fill_a)
  local border_u32 = pack(border_r, border_g, border_b, border_a)

  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + w, y + h, fill_u32, radius)
  reaper.ImGui_DrawList_AddRect(draw_list, x, y, x + w, y + h, border_u32, radius, 0, scale or 1.0)
end

function components.draw_header(draw_list, x, y, w, h, scale, opts)
  local c = theme.colors()
  local r = theme.radii(scale)
  local radius = (opts and opts.radius) or r.lg
  local grad = (opts and opts.gradient) or c.topbarGradient
  local border = (opts and opts.border) or c.topbarBorder

  local g1_r, g1_g, g1_b, g1_a = resolve_color(grad[1])
  local g2_r, g2_g, g2_b, g2_a = resolve_color(grad[2])
  local b_r, b_g, b_b, b_a = resolve_color(border)

  local g1 = pack(g1_r, g1_g, g1_b, g1_a)
  local g2 = pack(g2_r, g2_g, g2_b, g2_a)
  local b = pack(b_r, b_g, b_b, b_a)

  if reaper.ImGui_DrawList_AddRectFilledMultiColor then
    reaper.ImGui_DrawList_AddRectFilledMultiColor(draw_list, x, y, x + w, y + h, g1, g1, g2, g2)
  else
    reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + w, y + h, g1, radius)
  end

  reaper.ImGui_DrawList_AddRect(draw_list, x, y + h - scale, x + w, y + h, b, 0, 0, scale or 1.0)
end

function components.button(ctx, id, label, w, h, scale, opts)
  local c = theme.colors()
  local r = theme.radii(scale)
  local radius = (opts and opts.radius) or r.md

  local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
  reaper.ImGui_InvisibleButton(ctx, id, w, h)
  local hovered = reaper.ImGui_IsItemHovered(ctx)
  local active = reaper.ImGui_IsItemActive(ctx)
  local pressed = reaper.ImGui_IsItemClicked(ctx)

  local fill = c.surface
  if active then
    fill = c.elevated
  elseif hovered then
    fill = c.slot
  end

  local fill_r, fill_g, fill_b, fill_a = resolve_color(fill)
  local border_r, border_g, border_b, border_a = resolve_color(c.border)
  local draw_list = reaper.ImGui_GetWindowDrawList(ctx)

  reaper.ImGui_DrawList_AddRectFilled(draw_list, x, y, x + w, y + h,
    pack(fill_r, fill_g, fill_b, fill_a), radius)
  reaper.ImGui_DrawList_AddRect(draw_list, x, y, x + w, y + h,
    pack(border_r, border_g, border_b, border_a), radius, 0, scale or 1.0)

  local text_w, text_h = reaper.ImGui_CalcTextSize(ctx, label)
  local tx = x + (w - text_w) * 0.5
  local ty = y + (h - text_h) * 0.5
  local text_r, text_g, text_b, text_a = resolve_color(c.text)
  reaper.ImGui_DrawList_AddText(draw_list, tx, ty, pack(text_r, text_g, text_b, text_a), label)

  return pressed
end

function components.text(ctx, text, style, scale)
  local c = theme.colors()
  local color = c.text
  if style == 'muted' then
    color = c.textMuted
  end
  local r, g, b, a = resolve_color(color)
  if reaper.ImGui_TextColored then
    reaper.ImGui_TextColored(ctx, r, g, b, a, text)
  else
    reaper.ImGui_Text(ctx, text)
  end
end

function components.layout_row(ctx, items, gap)
  local g = gap or 0
  for i, item in ipairs(items) do
    if i > 1 then
      reaper.ImGui_SameLine(ctx, nil, g)
    end
    item()
  end
end

function components.layout_column(ctx, items, gap)
  local g = gap or 0
  for i, item in ipairs(items) do
    if i > 1 then
      reaper.ImGui_Dummy(ctx, 0, g)
    end
    item()
  end
end

components.controls = controls

return components
