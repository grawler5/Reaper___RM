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

local function right_align(ctx, right_w)
  if not (reaper.ImGui_GetContentRegionAvail and reaper.ImGui_Dummy and reaper.ImGui_SameLine) then return end
  local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
  if type(avail_w) ~= 'number' then return end
  local pad = avail_w - (right_w or 0)
  if pad > 1 then
    reaper.ImGui_Dummy(ctx, pad, 0)
    reaper.ImGui_SameLine(ctx, 0, 0)
  end
end

function panel.render_header(ctx, ws, scale, ui)
  local track_name = ws.track_name or 'Track'
  local fx_name = ws.fx_name or 'FX'
  local enabled = true
  if reaper.TrackFX_GetEnabled then
    enabled = reaper.TrackFX_GetEnabled(ws.track, ws.fx)
  end

  local btn_h = 26 * scale
  local gap = 8 * scale
  local w_insp = 108 * scale
  local w_on = 54 * scale
  local w_x = 30 * scale
  local right_w = w_insp + gap + w_on + gap + w_x

  if reaper.ImGui_GetWindowDrawList and reaper.ImGui_DrawList_AddRectFilled then
    local dl = reaper.ImGui_GetWindowDrawList(ctx)
    local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
    local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx)) or 0
    local h = 30 * scale
    local top = reaper.ImGui_ColorConvertDouble4ToU32 and reaper.ImGui_ColorConvertDouble4ToU32(0.16, 0.16, 0.16, 1.0) or nil
    local bot = reaper.ImGui_ColorConvertDouble4ToU32 and reaper.ImGui_ColorConvertDouble4ToU32(0.12, 0.12, 0.12, 1.0) or nil
    if dl and top and bot and avail_w > 1 then
      if reaper.ImGui_DrawList_AddRectFilledMultiColor then
        reaper.ImGui_DrawList_AddRectFilledMultiColor(dl, x, y, x + avail_w, y + h, top, top, bot, bot)
      else
        reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + avail_w, y + h, top, 10 * scale)
      end
    end
  end

  reaper.ImGui_PushStyleVar(ctx, compat.resolve_enum(reaper.ImGui_StyleVar_FramePadding) or reaper.ImGui_StyleVar_FramePadding, 12 * scale, 6 * scale)
  reaper.ImGui_AlignTextToFramePadding(ctx)
  ui.push_color(ctx, reaper.ImGui_Col_Text, 0.92, 0.92, 0.92, 1.0)
  reaper.ImGui_Text(ctx, tostring(track_name) .. ' • ' .. tostring(fx_name))
  pcall(reaper.ImGui_PopStyleColor, ctx)

  reaper.ImGui_SameLine(ctx, 0, 0)
  right_align(ctx, right_w)

  if ws.show_inspector then
    ui.push_color(ctx, reaper.ImGui_Col_Button, 0.24, 0.26, 0.30, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.28, 0.30, 0.34, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.22, 0.24, 0.28, 1.0)
  else
    ui.push_color(ctx, reaper.ImGui_Col_Button, 0.18, 0.19, 0.22, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.22, 0.23, 0.26, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.16, 0.17, 0.20, 1.0)
  end
  if reaper.ImGui_Button(ctx, 'Inspector##' .. ws.id, w_insp, btn_h) then
    ws.show_inspector = not ws.show_inspector
  end
  pcall(reaper.ImGui_PopStyleColor, ctx, 3)
  reaper.ImGui_SameLine(ctx, 0, gap)

  if enabled then
    ui.push_color(ctx, reaper.ImGui_Col_Button, 0.20, 0.40, 0.78, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.22, 0.46, 0.86, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.18, 0.34, 0.68, 1.0)
  else
    ui.push_color(ctx, reaper.ImGui_Col_Button, 0.20, 0.20, 0.20, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.24, 0.24, 0.24, 1.0)
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.18, 0.18, 0.18, 1.0)
  end
  if reaper.ImGui_Button(ctx, enabled and 'ON##' .. ws.id or 'OFF##' .. ws.id, w_on, btn_h) then
    if reaper.TrackFX_SetEnabled then
      reaper.TrackFX_SetEnabled(ws.track, ws.fx, not enabled)
    end
  end
  pcall(reaper.ImGui_PopStyleColor, ctx, 3)

  reaper.ImGui_SameLine(ctx, 0, gap)
  ui.push_color(ctx, reaper.ImGui_Col_Button, 0.20, 0.20, 0.22, 1.0)
  ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, 0.26, 0.26, 0.28, 1.0)
  ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, 0.18, 0.18, 0.20, 1.0)
  ui.push_color(ctx, reaper.ImGui_Col_Text, 0.92, 0.92, 0.92, 1.0)
  if reaper.ImGui_Button(ctx, 'X##' .. ws.id, w_x, btn_h) then
    ws.request_close = true
  end
  pcall(reaper.ImGui_PopStyleColor, ctx, 4)

  pcall(reaper.ImGui_PopStyleVar, ctx, 1)
  reaper.ImGui_Dummy(ctx, 0, 6 * scale)
end

function panel.render_presets_row(ctx, ws, scale, ui)
  local list = ws.presets or {}
  local btn_h = 26 * scale
  local gap = 8 * scale
  local w_save = 72 * scale
  local w_del = 84 * scale
  local right_w = w_save + gap + w_del

  local avail_w = 0
  if reaper.ImGui_GetContentRegionAvail then
    avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx)) or 0
  end
  local combo_w = math.max(180 * scale, avail_w - right_w - gap)

  reaper.ImGui_PushStyleVar(ctx, compat.resolve_enum(reaper.ImGui_StyleVar_FramePadding) or reaper.ImGui_StyleVar_FramePadding, 12 * scale, 6 * scale)
  if reaper.ImGui_PushItemWidth then reaper.ImGui_PushItemWidth(ctx, combo_w) end

  local preview = 'Default'
  if ws._preset_sel and ws._preset_sel > 0 and list[ws._preset_sel] then
    preview = tostring(list[ws._preset_sel].name or 'Preset')
  end

  local combo_ok = false
  if reaper.ImGui_BeginCombo then
    combo_ok = reaper.ImGui_BeginCombo(ctx, '##preset' .. ws.id, preview)
    if combo_ok then
      if reaper.ImGui_Selectable(ctx, 'Default', ws._preset_sel == 0) then
        ws._preset_sel = 0
        ws.request_apply_preset = true
      end
      for i, pr in ipairs(list) do
        local name = tostring(pr.name or ('Preset ' .. i))
        if reaper.ImGui_Selectable(ctx, name, ws._preset_sel == i) then
          ws._preset_sel = i
          ws.request_apply_preset = true
        end
      end
      reaper.ImGui_EndCombo(ctx)
    end
  else
    reaper.ImGui_Text(ctx, preview)
  end

  if reaper.ImGui_PopItemWidth then reaper.ImGui_PopItemWidth(ctx) end
  reaper.ImGui_PopStyleVar(ctx)

  reaper.ImGui_SameLine(ctx, 0, 0)
  right_align(ctx, right_w)
  if reaper.ImGui_Button(ctx, 'Save##' .. ws.id, w_save, btn_h) then ws.request_save_preset = true end
  reaper.ImGui_SameLine(ctx, 0, gap)
  if reaper.ImGui_Button(ctx, 'Delete##' .. ws.id, w_del, btn_h) then ws.request_delete_preset = true end

  reaper.ImGui_Separator(ctx)
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state and (state.scale or state.ui_scale)) or 1.0

  local v = clamp01(params.get_norm(track, fx, IDX_AMOUNT))
  local dl_ok = (reaper.ImGui_GetWindowDrawList ~= nil) and (reaper.ImGui_DrawList_AddRectFilled ~= nil) and (reaper.ImGui_ColorConvertDouble4ToU32 ~= nil)

  -- Web UI proportions: single unified panel with a bottom readout.
  local base_w = 300 * scale
  local base_total = 470 * scale
  local base_main = 370 * scale

  local avail_w, avail_h = 0, 0
  if reaper.ImGui_GetContentRegionAvail then
    avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  end
  local fit = 1.0
  if type(avail_w) == 'number' and type(avail_h) == 'number' and avail_w > 1 and avail_h > 1 then
    fit = math.min(1.0, avail_w / base_w, avail_h / base_total)
  end

  local draw_scale = scale * fit
  local panel_w = base_w * fit
  local total_h = base_total * fit
  local main_h = base_main * fit
  local read_h = total_h - main_h

  -- Center the panel area in the window content region
  center_x(ctx, panel_w)

  -- Child to keep layout stable and avoid SetCursor* (ReaImGui 0.10.x)
  local child_started = false
  if reaper.ImGui_BeginChild then
    reaper.ImGui_BeginChild(ctx, '##rm_ns_panel', panel_w, total_h, 0, 0)
    child_started = true
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

    local r = 18 * draw_scale
    local bg1 = reaper.ImGui_ColorConvertDouble4ToU32(0.22, 0.23, 0.25, 1.0)
    local bg2 = reaper.ImGui_ColorConvertDouble4ToU32(0.16, 0.17, 0.19, 1.0)
    local bd  = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.60)
    local inl = reaper.ImGui_ColorConvertDouble4ToU32(1, 1, 1, 0.08)

    -- Panel background
    dl_rect_multi(dl, x0, y0, x0 + panel_w, y0 + total_h, bg1, bg1, bg2, bg2)
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + total_h, bd, r, 0, 1.0)
    reaper.ImGui_DrawList_AddRect(dl, x0 + 1, y0 + 1, x0 + panel_w - 1, y0 + total_h - 1, inl, r - 1, 0, 1.0)

    -- Inner panel (lighter, like web UI inset)
    local inner_pad_x = 26 * draw_scale
    local inner_pad_y = 16 * draw_scale
    local inner_x1 = x0 + inner_pad_x
    local inner_y1 = y0 + inner_pad_y
    local inner_x2 = x0 + panel_w - inner_pad_x
    local inner_y2 = y0 + main_h - inner_pad_y
    local inner_r = 16 * draw_scale
    local inner_top = reaper.ImGui_ColorConvertDouble4ToU32(0.50, 0.52, 0.55, 1.0)
    local inner_bot = reaper.ImGui_ColorConvertDouble4ToU32(0.38, 0.40, 0.43, 1.0)
    local inner_bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.40)
    dl_rect_multi(dl, inner_x1, inner_y1, inner_x2, inner_y2, inner_top, inner_top, inner_bot, inner_bot)
    reaper.ImGui_DrawList_AddRect(dl, inner_x1, inner_y1, inner_x2, inner_y2, inner_bd, inner_r, 0, 1.0)

    -- Track
    local tr_w = 12 * draw_scale
    local tr_x = x0 + (panel_w - tr_w) * 0.5
    local tr_y1 = inner_y1 + 20 * draw_scale
    local tr_y2 = inner_y2 - 20 * draw_scale
    local tr_col = reaper.ImGui_ColorConvertDouble4ToU32(0.12, 0.12, 0.12, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, tr_x, tr_y1, tr_x + tr_w, tr_y2, tr_col, tr_w * 0.5)

    -- Thumb position (top = 1.0)
    local th_w = 150 * draw_scale
    local th_h = 48 * draw_scale
    local t = 1.0 - v
    local th_y = tr_y1 + t * ((tr_y2 - tr_y1) - th_h)
    local th_x1 = x0 + (panel_w - th_w) * 0.5
    local th_x2 = th_x1 + th_w

    local th1 = reaper.ImGui_ColorConvertDouble4ToU32(0.54, 0.56, 0.60, 1.0)
    local th2 = reaper.ImGui_ColorConvertDouble4ToU32(0.42, 0.44, 0.48, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, th_x1, th_y, th_x2, th_y + th_h, th1, 12 * draw_scale)
    reaper.ImGui_DrawList_AddRectFilled(dl, th_x1 + 1, th_y + 1, th_x2 - 1, th_y + th_h - 1, th2, 11 * draw_scale)

    -- Grip lines
    local grip_col = reaper.ImGui_ColorConvertDouble4ToU32(0.26, 0.26, 0.28, 0.9)
    local gx = (th_x1 + th_x2) * 0.5
    local gy = th_y + th_h * 0.5
    local lg = 40 * draw_scale
    for i = -1, 1 do
      local yy = gy + i * 6 * draw_scale
      reaper.ImGui_DrawList_AddLine(dl, gx - lg * 0.5, yy, gx + lg * 0.5, yy, grip_col, 2.0)
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
  local txt_val = string.format('%.1f', v * 100)
  if dl_ok and reaper.ImGui_GetCursorScreenPos then
    local dl = reaper.ImGui_GetWindowDrawList(ctx)
    local rx = x0 + (panel_w - (160 * draw_scale)) * 0.5
    local ry = y0 + main_h + (read_h - (54 * draw_scale)) * 0.5
    local rw = 162 * draw_scale
    local rh = 56 * draw_scale
    local rr = 16 * draw_scale
    local bg = reaper.ImGui_ColorConvertDouble4ToU32(0.04, 0.04, 0.05, 1.0)
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
    reaper.ImGui_Dummy(ctx, 0, 10 * draw_scale)
    ui.push_color(ctx, reaper.ImGui_Col_Text, 1.0, 0.56, 0.18, 1.0)
    reaper.ImGui_Text(ctx, txt_val)
    pcall(reaper.ImGui_PopStyleColor, ctx)
  end

  if child_started and reaper.ImGui_EndChild then
    reaper.ImGui_EndChild(ctx)
  end
end


return panel
