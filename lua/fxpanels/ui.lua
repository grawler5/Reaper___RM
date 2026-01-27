local compat = require('fxpanels.compat')

local ui = {}

-- Resolve ReaImGui enum values that may be exposed as numbers or functions.
local function E(v)
  return compat.resolve_enum(v) or v
end

local function resolve_flag(value)
  return compat.resolve_enum(value)
end

local function is_child_window(ctx)
  if reaper.ImGui_GetWindowFlags == nil or reaper.ImGui_WindowFlags_ChildWindow == nil then
    return nil
  end
  local child_flag = resolve_flag(reaper.ImGui_WindowFlags_ChildWindow) or 0
  if child_flag == 0 then
    return nil
  end
  local flags = reaper.ImGui_GetWindowFlags(ctx)
  if type(flags) ~= 'number' then
    return nil
  end
  return compat.band(flags, child_flag) ~= 0
end

function ui.push_color(ctx, color, r, g, b, a)
  color = E(color)
  if color == nil then return end
  if reaper.ImGui_ColorConvertDouble4ToU32 then
    local packed = reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
    reaper.ImGui_PushStyleColor(ctx, color, packed)
  else
    reaper.ImGui_PushStyleColor(ctx, color, r, g, b, a)
  end
end

function ui._begin_child(ctx, title, w, h, border, window_flags)
  local flags_available = reaper.ImGui_ChildFlags_Borders ~= nil
    or reaper.ImGui_ChildFlags_Border ~= nil
    or reaper.ImGui_ChildFlags_None ~= nil
  local resolved_window_flags = window_flags or 0

  if flags_available then
    local child_flags = 0
    if border then
      if reaper.ImGui_ChildFlags_Borders ~= nil then
        child_flags = resolve_flag(reaper.ImGui_ChildFlags_Borders) or 0
      elseif reaper.ImGui_ChildFlags_Border ~= nil then
        child_flags = resolve_flag(reaper.ImGui_ChildFlags_Border) or 0
      end
    elseif reaper.ImGui_ChildFlags_None ~= nil then
      child_flags = resolve_flag(reaper.ImGui_ChildFlags_None) or 0
    end
    local ok, opened = pcall(reaper.ImGui_BeginChild, ctx, title, w, h, child_flags, resolved_window_flags)
    if ok then
      -- IMPORTANT: even if BeginChild returns false (not visible), you must still call EndChild.
      return opened, true
    end
  end

  -- ReaImGui 0.10.x expects a *number* for the 5th parameter (child/window flags),
  -- not a boolean border flag. Passing boolean can error and break the ImGui context.
  local legacy_border = 0
  local ok, opened = pcall(reaper.ImGui_BeginChild, ctx, title, w, h, legacy_border, resolved_window_flags)
  if ok then
    -- IMPORTANT: even if BeginChild returns false (not visible), you must still call EndChild.
    -- So we return is_child=true unconditionally when BeginChild succeeded.
    return opened, true
  end

  -- Older ReaImGui (0.10.x) may not support the window_flags parameter.
  local ok2, opened2 = pcall(reaper.ImGui_BeginChild, ctx, title, w, h, legacy_border)
  if ok2 then
    return opened2, true
  end
  return false, false
end

-- Run a function inside a child region and ALWAYS close it, even if the function errors.
-- This prevents ImGui context corruption ("Must call EndChild() and not End()!") on ReaImGui 0.10.x/macOS.
function ui.with_child(ctx, title, w, h, border, window_flags, fn)
  local opened, is_child = ui._begin_child(ctx, title, w, h, border, window_flags)
  local ok, err = xpcall(function()
    if opened and fn then fn() end
  end, debug.traceback)
  if is_child then
    pcall(reaper.ImGui_EndChild, ctx)
  end
  if not ok then
    error(err)
  end
  return opened
end

local function slider_impl(ctx, label, value, min, max)
  if reaper.ImGui_SliderDouble ~= nil then
    return reaper.ImGui_SliderDouble(ctx, label, value, min, max)
  end
  return reaper.ImGui_SliderFloat(ctx, label, value, min, max)
end

function ui.begin_section(ctx, title, scale, height)
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_FramePadding), 6 * scale, 4 * scale)
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_ItemSpacing), 8 * scale, 6 * scale)
  local opened, is_child = ui._begin_child(ctx, title, 0, height or 0, true)
  if opened then
    reaper.ImGui_Text(ctx, title)
    reaper.ImGui_Separator(ctx)
  end
  return opened, is_child
end

function ui.end_section(ctx, is_child)
  if is_child then
    reaper.ImGui_EndChild(ctx)
  end
  reaper.ImGui_PopStyleVar(ctx, 2)
end

function ui.toggle(ctx, label, value, scale)
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_FramePadding), 6 * scale, 6 * scale)
  local changed, new_value = reaper.ImGui_Checkbox(ctx, label, value)
  reaper.ImGui_PopStyleVar(ctx)
  return changed, new_value
end

function ui.slider(ctx, label, value, scale, format)
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_FramePadding), 6 * scale, 6 * scale)
  reaper.ImGui_PushItemWidth(ctx, 220 * scale)
  local changed, new_value = slider_impl(ctx, label, value, 0.0, 1.0)
  reaper.ImGui_PopItemWidth(ctx)
  reaper.ImGui_PopStyleVar(ctx)
  if format then
    reaper.ImGui_SameLine(ctx)
    reaper.ImGui_Text(ctx, format)
  end
  return changed, new_value
end

function ui.value_text(value)
  return string.format('%d%%', math.floor((value or 0) * 100 + 0.5))
end

local function mk_items(items)
  local out = {}
  for _, v in ipairs(items) do
    out[#out + 1] = tostring(v)
  end
  return table.concat(out, '\0') .. '\0'
end

function ui.combo(ctx, label, current_index, items, scale, width)
  if width then
    reaper.ImGui_PushItemWidth(ctx, width * scale)
  end
  local changed, new_index = reaper.ImGui_Combo(ctx, label, current_index, mk_items(items))
  if width then
    reaper.ImGui_PopItemWidth(ctx)
  end
  return changed, new_index
end

function ui.vslider(ctx, label, value, scale, height, format)
  local w = 42 * scale
  local h = (height or 220) * scale
  local changed, new_value
  if reaper.ImGui_VSliderDouble ~= nil then
    changed, new_value = reaper.ImGui_VSliderDouble(ctx, label, w, h, value, 0.0, 1.0)
  elseif reaper.ImGui_VSliderFloat ~= nil then
    changed, new_value = reaper.ImGui_VSliderFloat(ctx, label, w, h, value, 0.0, 1.0)
  else
    -- Fallback: horizontal slider with fixed width
    reaper.ImGui_PushItemWidth(ctx, 220 * scale)
    changed, new_value = slider_impl(ctx, label, value, 0.0, 1.0)
    reaper.ImGui_PopItemWidth(ctx)
  end
  if format then
    reaper.ImGui_Text(ctx, format)
  end
  return changed, new_value
end

function ui.meter_v(ctx, value, scale, height)
  local v = compat.clamp(value or 0, 0, 1)
  local w = 16 * scale
  local h = (height or 220) * scale

  if compat.has_drawlist() and reaper.ImGui_GetCursorScreenPos and reaper.ImGui_DrawList_AddRectFilled then
    local draw = reaper.ImGui_GetWindowDrawList(ctx)
    local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
    local x2 = x + w
    local y2 = y + h
    local fill_y = y2 - h * v

    reaper.ImGui_InvisibleButton(ctx, '##meter' .. tostring(x) .. ':' .. tostring(y), w, h)

    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.10, 0.10, 0.12, 1.0)
    local fg = reaper.ImGui_ColorConvertDouble4ToU32(0.28, 0.72, 0.40, 1.0)
    local bd = reaper.ImGui_ColorConvertDouble4ToU32(0.25, 0.25, 0.28, 1.0)

    reaper.ImGui_DrawList_AddRectFilled(draw, x, y, x2, y2, bg)
    reaper.ImGui_DrawList_AddRectFilled(draw, x, fill_y, x2, y2, fg)
    reaper.ImGui_DrawList_AddRect(draw, x, y, x2, y2, bd)
  else
    reaper.ImGui_ProgressBar(ctx, v, w, h)
  end
end

function ui.knob_norm(ctx, id, value, scale, size, label, value_text)
  local v = compat.clamp(value or 0, 0, 1)
  local s = (size or 48) * scale

  if label and label ~= '' then
    reaper.ImGui_Text(ctx, label)
  end

  local changed = false
  local new_v = v

  if compat.has_drawlist()
    and reaper.ImGui_GetCursorScreenPos
    and reaper.ImGui_InvisibleButton
    and reaper.ImGui_IsItemActive
    and reaper.ImGui_GetMouseDelta
    and reaper.ImGui_DrawList_AddCircleFilled
    and reaper.ImGui_DrawList_AddCircle
    and reaper.ImGui_DrawList_AddLine
  then
    local draw = reaper.ImGui_GetWindowDrawList(ctx)
    local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
    local cx, cy = x + s / 2, y + s / 2
    local r = s * 0.42

    reaper.ImGui_InvisibleButton(ctx, id, s, s)

    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.16, 0.17, 0.20, 1.0)
    local bd = reaper.ImGui_ColorConvertDouble4ToU32(0.25, 0.26, 0.30, 1.0)
    local fg = reaper.ImGui_ColorConvertDouble4ToU32(0.82, 0.75, 0.66, 1.0)

    reaper.ImGui_DrawList_AddCircleFilled(draw, cx, cy, r, bg)
    reaper.ImGui_DrawList_AddCircle(draw, cx, cy, r, bd)

    -- Knob sweep should start around 7 o'clock and end around 5 o'clock.
    local ang_min = math.rad(225)
    local ang_max = math.rad(315)
    local ang = ang_min + (ang_max - ang_min) * v
    local px = cx + math.cos(ang) * (r * 0.85)
    local py = cy + math.sin(ang) * (r * 0.85)
    reaper.ImGui_DrawList_AddLine(draw, cx, cy, px, py, fg, 2.0)

    if reaper.ImGui_IsItemActive(ctx) then
      local dx, dy = reaper.ImGui_GetMouseDelta(ctx)
      if dy ~= 0 or dx ~= 0 then
        new_v = compat.clamp(v - dy * 0.005 - dx * 0.001, 0, 1)
        changed = (new_v ~= v)
      end
    end
  else
    reaper.ImGui_PushItemWidth(ctx, 120 * scale)
    local c, nv = slider_impl(ctx, id, v, 0.0, 1.0)
    reaper.ImGui_PopItemWidth(ctx)
    changed = c
    new_v = nv
  end

  if value_text then
    reaper.ImGui_Text(ctx, value_text)
  end

  return changed, new_v
end

return ui
