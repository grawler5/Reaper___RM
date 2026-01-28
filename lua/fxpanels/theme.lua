local compat = require('fxpanels.compat')
local tokens = require('webui_tokens')

local theme = {}

local function hex_to_rgba(hex, alpha)
  local h = hex:gsub('#', '')
  if #h == 3 then
    h = h:sub(1, 1):rep(2) .. h:sub(2, 2):rep(2) .. h:sub(3, 3):rep(2)
  end
  local r = tonumber(h:sub(1, 2), 16) / 255
  local g = tonumber(h:sub(3, 4), 16) / 255
  local b = tonumber(h:sub(5, 6), 16) / 255
  return r, g, b, alpha or 1.0
end

local function scale(v, s)
  return (v or 0) * (s or 1.0)
end

function theme.colors()
  return tokens.colors
end

function theme.metrics(scale_factor)
  local m = tokens.metrics
  local s = scale_factor or 1.0
  return {
    topbar_h = scale(m.topbar_h, s),
    control_h = scale(m.control_h, s),
    control_w = scale(m.control_w, s),
    control_radius = scale(m.control_radius, s),
    control_font = scale(m.control_font, s),
    control_pad_x = scale(m.control_pad_x, s),
    window_round = scale(m.window_round, s),
    border_size = scale(m.border_size or 1, s),
    frame_round = scale(m.frame_round, s),
    child_round = scale(m.child_round, s),
    popup_round = scale(m.popup_round, s),
    window_pad_x = scale(m.window_pad_x, s),
    window_pad_y = scale(m.window_pad_y, s),
    item_space_x = scale(m.item_space_x, s),
    item_space_y = scale(m.item_space_y, s),
    toolbar_gap = scale(m.toolbar_gap, s),
    card_pad_x = scale(m.card_pad_x, s),
    card_pad_y = scale(m.card_pad_y, s),
  }
end

function theme.push(ctx, scale_factor)
  local sv, sc = 0, 0
  local function PSV(var, ...)
    local ok = pcall(reaper.ImGui_PushStyleVar, ctx, compat.resolve_enum(var) or var, ...)
    if ok then sv = sv + 1 end
  end
  local function PSC(col, r, g, b, a)
    local color = compat.resolve_enum(col) or col
    local ok = false
    if reaper.ImGui_ColorConvertDouble4ToU32 then
      local packed = reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
      ok = pcall(reaper.ImGui_PushStyleColor, ctx, color, packed)
    else
      ok = pcall(reaper.ImGui_PushStyleColor, ctx, color, r, g, b, a)
    end
    if ok then sc = sc + 1 end
  end

  local m = theme.metrics(scale_factor)
  local c = theme.colors()

  PSV(reaper.ImGui_StyleVar_WindowRounding, m.window_round)
  PSV(reaper.ImGui_StyleVar_WindowBorderSize, m.border_size)
  PSV(reaper.ImGui_StyleVar_FrameRounding, m.control_radius)
  PSV(reaper.ImGui_StyleVar_FrameBorderSize, m.border_size)
  PSV(reaper.ImGui_StyleVar_ChildRounding, m.child_round)
  PSV(reaper.ImGui_StyleVar_PopupRounding, m.popup_round)
  PSV(reaper.ImGui_StyleVar_WindowPadding, m.window_pad_x, m.window_pad_y)
  PSV(reaper.ImGui_StyleVar_FramePadding, m.control_pad_x, (m.control_h - m.control_font) * 0.5)
  PSV(reaper.ImGui_StyleVar_ItemSpacing, m.item_space_x, m.item_space_y)

  PSC(reaper.ImGui_Col_WindowBg, hex_to_rgba(c.bg))
  PSC(reaper.ImGui_Col_ChildBg, hex_to_rgba(c.panel))
  PSC(reaper.ImGui_Col_FrameBg, hex_to_rgba(c.panel_alt))
  PSC(reaper.ImGui_Col_Border, hex_to_rgba(c.border))
  PSC(reaper.ImGui_Col_Text, hex_to_rgba(c.text))
  PSC(reaper.ImGui_Col_TextDisabled, hex_to_rgba(c.muted))
  PSC(reaper.ImGui_Col_Button, hex_to_rgba(c.panel))
  PSC(reaper.ImGui_Col_ButtonHovered, hex_to_rgba(c.slot))
  PSC(reaper.ImGui_Col_ButtonActive, hex_to_rgba(c.panel_alt))
  PSC(reaper.ImGui_Col_Header, hex_to_rgba(c.panel))
  PSC(reaper.ImGui_Col_HeaderHovered, hex_to_rgba(c.slot))
  PSC(reaper.ImGui_Col_HeaderActive, hex_to_rgba(c.panel_alt))
  PSC(reaper.ImGui_Col_Separator, hex_to_rgba(c.border))

  return sv, sc
end

function theme.pop(ctx, sv, sc)
  if sc and sc > 0 then pcall(reaper.ImGui_PopStyleColor, ctx, sc) end
  if sv and sv > 0 then pcall(reaper.ImGui_PopStyleVar, ctx, sv) end
end

function theme.rgba(hex, alpha)
  return hex_to_rgba(hex, alpha)
end

return theme
