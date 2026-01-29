local compat = require('fxpanels.compat')
local tokens = require('fxpanels.tokens.web_tokens')

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

local function scale_value(v, s)
  return (v or 0) * (s or 1.0)
end

function theme.tokens()
  return tokens
end

function theme.colors()
  return tokens.colors
end

function theme.radii(scale_factor)
  local r = tokens.radii
  local s = scale_factor or 1.0
  return {
    xs = scale_value(r.xs, s),
    sm = scale_value(r.sm, s),
    md = scale_value(r.md, s),
    lg = scale_value(r.lg, s),
  }
end

function theme.spacing(scale_factor)
  local sp = tokens.spacing
  local s = scale_factor or 1.0
  return {
    s2 = scale_value(sp.s2, s),
    s4 = scale_value(sp.s4, s),
    s8 = scale_value(sp.s8, s),
    s12 = scale_value(sp.s12, s),
    s16 = scale_value(sp.s16, s),
    s24 = scale_value(sp.s24, s),
  }
end

function theme.typography(scale_factor)
  local t = tokens.typography
  local s = scale_factor or 1.0
  return {
    family = t.family,
    sizes = {
      caption = scale_value(t.sizes.caption, s),
      label = scale_value(t.sizes.label, s),
      body = scale_value(t.sizes.body, s),
      title = scale_value(t.sizes.title, s),
    },
    weights = t.weights,
  }
end

function theme.metrics(scale_factor)
  local m = tokens.metrics
  local s = scale_factor or 1.0
  return {
    topbar_h = scale_value(m.topbarHeight, s),
    control_h = scale_value(m.controlHeight, s),
    control_w = scale_value(m.controlWidth, s),
    control_radius = scale_value(m.controlRadius, s),
    control_font = scale_value(m.controlFont, s),
    control_pad_x = scale_value(m.controlPadX, s),
    strip_w = scale_value(m.stripWidth, s),
    window_round = scale_value(m.windowRound, s),
    frame_round = scale_value(m.frameRound, s),
    child_round = scale_value(m.childRound, s),
    popup_round = scale_value(m.popupRound, s),
    window_pad_x = scale_value(m.windowPadX, s),
    window_pad_y = scale_value(m.windowPadY, s),
    item_space_x = scale_value(m.itemSpaceX, s),
    item_space_y = scale_value(m.itemSpaceY, s),
    toolbar_gap = scale_value(m.toolbarGap, s),
    card_pad_x = scale_value(m.cardPadX, s),
    card_pad_y = scale_value(m.cardPadY, s),
    slider_track_h = scale_value(m.sliderTrackHeight, s),
    slider_thumb = scale_value(m.sliderThumbSize, s),
    knob_size = scale_value(m.knobSize, s),
    knob_arc = scale_value(m.knobArcWidth, s),
  }
end

function theme.rgba(hex, alpha)
  return hex_to_rgba(hex, alpha)
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
  PSV(reaper.ImGui_StyleVar_FrameRounding, m.control_radius)
  PSV(reaper.ImGui_StyleVar_ChildRounding, m.child_round)
  PSV(reaper.ImGui_StyleVar_PopupRounding, m.popup_round)
  PSV(reaper.ImGui_StyleVar_WindowPadding, m.window_pad_x, m.window_pad_y)
  PSV(reaper.ImGui_StyleVar_FramePadding, m.control_pad_x, (m.control_h - m.control_font) * 0.5)
  PSV(reaper.ImGui_StyleVar_ItemSpacing, m.item_space_x, m.item_space_y)

  PSC(reaper.ImGui_Col_WindowBg, hex_to_rgba(c.bg))
  PSC(reaper.ImGui_Col_ChildBg, hex_to_rgba(c.surface))
  PSC(reaper.ImGui_Col_FrameBg, hex_to_rgba(c.elevated))
  PSC(reaper.ImGui_Col_Border, hex_to_rgba(c.border))
  PSC(reaper.ImGui_Col_Text, hex_to_rgba(c.text))
  PSC(reaper.ImGui_Col_TextDisabled, hex_to_rgba(c.textMuted))
  PSC(reaper.ImGui_Col_Button, hex_to_rgba(c.surface))
  PSC(reaper.ImGui_Col_ButtonHovered, hex_to_rgba(c.slot))
  PSC(reaper.ImGui_Col_ButtonActive, hex_to_rgba(c.elevated))
  PSC(reaper.ImGui_Col_Header, hex_to_rgba(c.surface))
  PSC(reaper.ImGui_Col_HeaderHovered, hex_to_rgba(c.slot))
  PSC(reaper.ImGui_Col_HeaderActive, hex_to_rgba(c.elevated))
  PSC(reaper.ImGui_Col_Separator, hex_to_rgba(c.border))

  return sv, sc
end

function theme.pop(ctx, sv, sc)
  if sc and sc > 0 then pcall(reaper.ImGui_PopStyleColor, ctx, sc) end
  if sv and sv > 0 then pcall(reaper.ImGui_PopStyleVar, ctx, sv) end
end

return theme
