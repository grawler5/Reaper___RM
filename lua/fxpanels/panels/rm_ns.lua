local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

-- RM_NS (noise suppressor) - 1:1 match with the Web UI (ns1Panel).

local panel = {}

-- Default window size tuned to match the Web UI proportions.
panel.meta = { win_w = 360, win_h = 560 }

-- Main control (0..1).
local IDX_AMOUNT = 0

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function center_x(ctx, w)
  if not (reaper.ImGui_GetContentRegionAvail and reaper.ImGui_Dummy and reaper.ImGui_SameLine) then return end
  local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
  if type(avail_w) ~= 'number' then return end
  local pad = (avail_w - w) * 0.5
  if pad > 1 then
    reaper.ImGui_Dummy(ctx, pad, 0)
    reaper.ImGui_SameLine(ctx)
  end
end


local function dl_rect_multi(dl, x1, y1, x2, y2, c1, c2, c3, c4)
  if reaper.ImGui_DrawList_AddRectFilledMultiColor then
    reaper.ImGui_DrawList_AddRectFilledMultiColor(dl, x1, y1, x2, y2, c1, c2, c3, c4)
  else
    reaper.ImGui_DrawList_AddRectFilled(dl, x1, y1, x2, y2, c1, 0)
  end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state and (state.scale or state.ui_scale)) or 1.0

  local v = clamp01(params.get_norm(track, fx, IDX_AMOUNT))
  local dl_ok = (reaper.ImGui_GetWindowDrawList ~= nil) and (reaper.ImGui_DrawList_AddRectFilled ~= nil) and (reaper.ImGui_ColorConvertDouble4ToU32 ~= nil)

  -- Web UI proportions: single unified panel with a bottom readout.
  local panel_w = 300 * scale
  local total_h = 460 * scale
  local main_h = 360 * scale
  local read_h = total_h - main_h

  -- Center the panel area in the window content region
  center_x(ctx, panel_w)

  -- Child to keep layout stable and avoid SetCursor* (ReaImGui 0.10.x)
  if reaper.ImGui_BeginChild then
    reaper.ImGui_BeginChild(ctx, '##rm_ns_panel', panel_w, total_h, 0, 0)
  end

  local x0, y0 = 0, 0
  if reaper.ImGui_GetCursorScreenPos then
    x0, y0 = reaper.ImGui_GetCursorScreenPos(ctx)
  end

  -- Interaction: capture drag on the whole panel (simple and stable)
  reaper.ImGui_InvisibleButton(ctx, '##rm_ns_drag', panel_w, main_h)
  if reaper.ImGui_IsItemActive(ctx) and reaper.ImGui_GetMouseDragDelta then
    local _, dy = reaper.ImGui_GetMouseDragDelta(ctx, 0)
    if type(dy) == 'number' and math.abs(dy) > 0 then
      v = clamp01(v - dy * 0.004)
      params.set_norm(track, fx, IDX_AMOUNT, v)
      if reaper.ImGui_ResetMouseDragDelta then reaper.ImGui_ResetMouseDragDelta(ctx, 0) end
    end
  end

  if dl_ok then
    local dl = reaper.ImGui_GetWindowDrawList(ctx)

    local r = 18 * scale
    local bg1 = reaper.ImGui_ColorConvertDouble4ToU32(0.26, 0.26, 0.26, 1.0)
    local bg2 = reaper.ImGui_ColorConvertDouble4ToU32(0.20, 0.20, 0.20, 1.0)
    local bd  = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.60)
    local inl = reaper.ImGui_ColorConvertDouble4ToU32(1, 1, 1, 0.08)

    -- Panel background
    dl_rect_multi(dl, x0, y0, x0 + panel_w, y0 + total_h, bg1, bg1, bg2, bg2)
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + total_h, bd, r, 0, 1.0)
    reaper.ImGui_DrawList_AddRect(dl, x0 + 1, y0 + 1, x0 + panel_w - 1, y0 + total_h - 1, inl, r - 1, 0, 1.0)

    -- Track
    local tr_w = 12 * scale
    local tr_x = x0 + (panel_w - tr_w) * 0.5
    local tr_y1 = y0 + 30 * scale
    local tr_y2 = y0 + main_h - 30 * scale
    local tr_col = reaper.ImGui_ColorConvertDouble4ToU32(0.14, 0.14, 0.14, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, tr_x, tr_y1, tr_x + tr_w, tr_y2, tr_col, tr_w * 0.5)

    -- Thumb position (top = 1.0)
    local th_w = 140 * scale
    local th_h = 44 * scale
    local t = 1.0 - v
    local th_y = tr_y1 + t * ((tr_y2 - tr_y1) - th_h)
    local th_x1 = x0 + (panel_w - th_w) * 0.5
    local th_x2 = th_x1 + th_w

    local th1 = reaper.ImGui_ColorConvertDouble4ToU32(0.66, 0.66, 0.66, 1.0)
    local th2 = reaper.ImGui_ColorConvertDouble4ToU32(0.52, 0.52, 0.52, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, th_x1, th_y, th_x2, th_y + th_h, th1, 12 * scale)
    reaper.ImGui_DrawList_AddRectFilled(dl, th_x1 + 1, th_y + 1, th_x2 - 1, th_y + th_h - 1, th2, 11 * scale)

    -- Grip lines
    local grip_col = reaper.ImGui_ColorConvertDouble4ToU32(0.25, 0.25, 0.25, 0.9)
    local gx = (th_x1 + th_x2) * 0.5
    local gy = th_y + th_h * 0.5
    local lg = 14 * scale
    for i = -1, 1 do
      local xx = gx + i * 6 * scale
      reaper.ImGui_DrawList_AddLine(dl, xx, gy - lg, xx, gy + lg, grip_col, 2.0)
    end
  else
    -- Fallback slider if drawlist is unavailable
    local changed, nv = reaper.ImGui_VSliderDouble and reaper.ImGui_VSliderDouble(ctx, '##ns', panel_w, main_h, v, 0.0, 1.0)
      or (reaper.ImGui_VSliderFloat and reaper.ImGui_VSliderFloat(ctx, '##ns', panel_w, main_h, v, 0.0, 1.0))
    if changed then
      v = clamp01(nv)
      params.set_norm(track, fx, IDX_AMOUNT, v)
    end
  end

  -- Readout (bottom black capsule like Web UI)
  local txt_val = string.format('%.0f', v * 100)
  if dl_ok and reaper.ImGui_GetCursorScreenPos then
    local dl = reaper.ImGui_GetWindowDrawList(ctx)
    local rx = x0 + (panel_w - (160 * scale)) * 0.5
    local ry = y0 + main_h + (read_h - (54 * scale)) * 0.5
    local rw = 160 * scale
    local rh = 54 * scale
    local rr = 14 * scale
    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.05, 0.05, 0.06, 1.0)
    local bd = reaper.ImGui_ColorConvertDouble4ToU32(0.0, 0.0, 0.0, 0.70)
    local inl = reaper.ImGui_ColorConvertDouble4ToU32(1.0, 1.0, 1.0, 0.07)
    reaper.ImGui_DrawList_AddRectFilled(dl, rx, ry, rx + rw, ry + rh, bg, rr)
    reaper.ImGui_DrawList_AddRect(dl, rx, ry, rx + rw, ry + rh, bd, rr, 0, 1.0)
    reaper.ImGui_DrawList_AddRect(dl, rx + 1, ry + 1, rx + rw - 1, ry + rh - 1, inl, rr - 1, 0, 1.0)

    -- Centered orange text
    local tw, th = 0, 0
    if reaper.ImGui_CalcTextSize then
      tw, th = reaper.ImGui_CalcTextSize(ctx, txt_val)
    end
    local tx = rx + (rw - (tw or 0)) * 0.5
    local ty = ry + (rh - (th or 0)) * 0.5
    local tc = reaper.ImGui_ColorConvertDouble4ToU32(1.0, 0.56, 0.18, 1.0)
    if reaper.ImGui_DrawList_AddText then
      reaper.ImGui_DrawList_AddText(dl, tx, ty, tc, txt_val)
    end
  else
    reaper.ImGui_Dummy(ctx, 0, 10 * scale)
    ui.push_color(ctx, reaper.ImGui_Col_Text, 1.0, 0.56, 0.18, 1.0)
    reaper.ImGui_Text(ctx, txt_val)
    pcall(reaper.ImGui_PopStyleColor, ctx)
  end

  if reaper.ImGui_EndChild then
    reaper.ImGui_EndChild(ctx)
  end
end


return panel