local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

-- RM_Gate - 1:1-inspired layout from Web UI (rmGatePanel).

local panel = {}

panel.meta = { win_w = 480, win_h = 520, scale_mult = 1.0 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function rect_multi(dl, x1, y1, x2, y2, c1, c2, c3, c4)
  if reaper.ImGui_DrawList_AddRectFilledMultiColor then
    reaper.ImGui_DrawList_AddRectFilledMultiColor(dl, x1, y1, x2, y2, c1, c2, c3, c4)
  else
    reaper.ImGui_DrawList_AddRectFilled(dl, x1, y1, x2, y2, c1, 0)
  end
end

local function knob(ctx, track, fx, ui, scale, label, idx)
  if not idx then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, '##rm_gate_' .. label, v, scale, 54, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

local function vslider(ctx, track, fx, ui, scale, label, idx, height)
  if not idx then return end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = params.get_formatted(track, fx, idx)
  local changed, nv = ui.vslider(ctx, '##rm_gate_' .. label, v, scale, height or 240, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold', 'thresh' }, default = 0 },
    attack = { patterns = { 'attack' }, default = 1 },
    release = { patterns = { 'release' }, default = 2 },
    range = { patterns = { 'range' }, default = 3 },
    in_peak = { patterns = { 'telemetry : in peak', 'in peak', 'input peak' } },
    gate_close = { patterns = { 'gate closure', 'closure' } },
  }, cache, 'rm_gate')

  local dl = reaper.ImGui_GetWindowDrawList and reaper.ImGui_GetWindowDrawList(ctx) or nil
  local has_draw = compat.has_drawlist() and dl ~= nil
  local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
  local panel_w = math.min(420 * scale, avail_w)
  local panel_h = 360 * scale

  if avail_w > panel_w + 2 then
    reaper.ImGui_Dummy(ctx, (avail_w - panel_w) * 0.5, 0)
    reaper.ImGui_SameLine(ctx, 0, 0)
  end

  local x0, y0 = compat.get_cursor_screen_pos(ctx)
  if has_draw then
    local bg_top = reaper.ImGui_ColorConvertDouble4ToU32(0.23, 0.25, 0.28, 1.0)
    local bg_bot = reaper.ImGui_ColorConvertDouble4ToU32(0.14, 0.15, 0.17, 1.0)
    local border = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.6)
    rect_multi(dl, x0, y0, x0 + panel_w, y0 + panel_h, bg_top, bg_top, bg_bot, bg_bot)
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + panel_h, border, 20 * scale, 0, 1.0)
  end

  reaper.ImGui_Dummy(ctx, panel_w, panel_h)

  local meter_w = 86 * scale
  local meter_h = 260 * scale
  local meter_x = x0 + (panel_w - meter_w) * 0.5
  local meter_y = y0 + 24 * scale

  local thresh = map.threshold ~= nil and clamp01(params.get_norm(track, fx, map.threshold)) or 0.0
  local in_pk = map.in_peak ~= nil and clamp01(params.get_norm(track, fx, map.in_peak)) or 0.0
  local close = map.gate_close ~= nil and clamp01(params.get_norm(track, fx, map.gate_close)) or 0.0
  local readout = map.threshold ~= nil and params.get_formatted(track, fx, map.threshold) or '—'

  if has_draw then
    local meter_bg = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.28)
    local meter_bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.55)
    local divider = reaper.ImGui_ColorConvertDouble4ToU32(0.12, 0.12, 0.12, 0.8)
    local fill_in = reaper.ImGui_ColorConvertDouble4ToU32(0.30, 1.0, 0.48, 0.95)
    local fill_in_hot = reaper.ImGui_ColorConvertDouble4ToU32(1.0, 0.52, 0.29, 0.95)
    local fill_act = reaper.ImGui_ColorConvertDouble4ToU32(1.0, 0.15, 0.15, 0.6)

    local left_x = meter_x
    local right_x = meter_x + meter_w * 0.5
    local mid_x = meter_x + meter_w * 0.5 - 2 * scale

    reaper.ImGui_DrawList_AddRectFilled(dl, meter_x, meter_y, meter_x + meter_w, meter_y + meter_h, meter_bg, 20 * scale)
    reaper.ImGui_DrawList_AddRect(dl, meter_x, meter_y, meter_x + meter_w, meter_y + meter_h, meter_bd, 20 * scale, 0, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, mid_x, meter_y, mid_x + 4 * scale, meter_y + meter_h, divider, 0)

    local in_h = meter_h * in_pk
    rect_multi(
      dl,
      left_x + 1 * scale,
      meter_y + meter_h - in_h,
      right_x - 2 * scale,
      meter_y + meter_h,
      fill_in,
      fill_in,
      fill_in_hot,
      fill_in_hot
    )

    local close_h = meter_h * close
    reaper.ImGui_DrawList_AddRectFilled(
      dl,
      right_x + 2 * scale,
      meter_y,
      meter_x + meter_w - 1 * scale,
      meter_y + close_h,
      fill_act
    )

    local thumb_y = meter_y + (1.0 - thresh) * meter_h
    local thumb_w = 128 * scale
    local thumb_h = 44 * scale
    local thumb_x = meter_x + (meter_w - thumb_w) * 0.5
    local thumb_bg = reaper.ImGui_ColorConvertDouble4ToU32(0.14, 0.16, 0.18, 1.0)
    local thumb_bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.75)
    reaper.ImGui_DrawList_AddRectFilled(dl, thumb_x, thumb_y - thumb_h * 0.5, thumb_x + thumb_w, thumb_y + thumb_h * 0.5, thumb_bg, 10 * scale)
    reaper.ImGui_DrawList_AddRect(dl, thumb_x, thumb_y - thumb_h * 0.5, thumb_x + thumb_w, thumb_y + thumb_h * 0.5, thumb_bd, 10 * scale, 0, 1.0)

    local title_col = reaper.ImGui_ColorConvertDouble4ToU32(1, 1, 1, 0.18)
    reaper.ImGui_DrawList_AddText(dl, x0 + 14 * scale, y0 + panel_h - 52 * scale, title_col, 'Gate')

    local read_w = 110 * scale
    local read_h = 32 * scale
    local read_x = x0 + (panel_w - read_w) * 0.5
    local read_y = meter_y + meter_h + 10 * scale
    local read_bg = reaper.ImGui_ColorConvertDouble4ToU32(0.05, 0.05, 0.06, 1.0)
    local read_bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.65)
    local read_tx = reaper.ImGui_ColorConvertDouble4ToU32(1.0, 0.7, 0.1, 1.0)
    reaper.ImGui_DrawList_AddRectFilled(dl, read_x, read_y, read_x + read_w, read_y + read_h, read_bg, 10 * scale)
    reaper.ImGui_DrawList_AddRect(dl, read_x, read_y, read_x + read_w, read_y + read_h, read_bd, 10 * scale, 0, 1.0)
    if reaper.ImGui_CalcTextSize then
      local tw, th = reaper.ImGui_CalcTextSize(ctx, readout or '')
      reaper.ImGui_DrawList_AddText(dl, read_x + (read_w - (tw or 0)) * 0.5, read_y + (read_h - (th or 0)) * 0.5, read_tx, readout or '')
    else
      reaper.ImGui_DrawList_AddText(dl, read_x + 8 * scale, read_y + 8 * scale, read_tx, readout or '')
    end
  end

  reaper.ImGui_Dummy(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Attack', map.attack)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Release', map.release)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Range', map.range)

  if map.threshold ~= nil and reaper.ImGui_InvisibleButton and reaper.ImGui_GetMousePos then
    local prev_x, prev_y = reaper.ImGui_GetCursorPos(ctx)
    local win_x, win_y = 0, 0
    if reaper.ImGui_GetWindowPos then
      win_x, win_y = reaper.ImGui_GetWindowPos(ctx)
    end
    local local_x = meter_x - (win_x or 0)
    local local_y = meter_y - (win_y or 0)
    if reaper.ImGui_SetCursorPos then
      reaper.ImGui_SetCursorPos(ctx, local_x, local_y)
    end
    reaper.ImGui_InvisibleButton(ctx, '##rm_gate_thresh', meter_w, meter_h)
    if reaper.ImGui_IsItemActive(ctx) then
      local _, my = reaper.ImGui_GetMousePos(ctx)
      local rel = compat.clamp((my - meter_y) / meter_h, 0, 1)
      params.set_norm(track, fx, map.threshold, 1.0 - rel)
    end
    if reaper.ImGui_SetCursorPos then
      reaper.ImGui_SetCursorPos(ctx, prev_x, prev_y)
    end
  end
end

return panel
