local params = require('fxpanels.params')
local compat = require('fxpanels.compat')
local theme = require('fxpanels.theme')

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

local function pack(r, g, b, a)
  if reaper.ImGui_ColorConvertDouble4ToU32 then
    return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
  end
  return r, g, b, a
end

local function rgba(token)
  if type(token) == 'string' then
    return theme.rgba(token)
  end
  if type(token) == 'table' then
    local r, g, b, a = token[1], token[2], token[3], token[4]
    if r > 1 or g > 1 or b > 1 then
      r, g, b = r / 255, g / 255, b / 255
    end
    return r or 0, g or 0, b or 0, a or 1
  end
  return 0, 0, 0, 1
end

local function rgba_pack(token)
  return pack(rgba(token))
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
  local tokens = theme.tokens().panels.rmGate
  local metrics = tokens.metrics
  local colors = tokens.colors

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
  local panel_w = math.min(metrics.maxW * scale, avail_w)
  local panel_h = math.max(metrics.minH * scale, 360 * scale)

  if avail_w > panel_w + 2 then
    reaper.ImGui_Dummy(ctx, (avail_w - panel_w) * 0.5, 0)
    reaper.ImGui_SameLine(ctx, 0, 0)
  end

  local x0, y0 = compat.get_cursor_screen_pos(ctx)
  if has_draw then
    rect_multi(dl, x0, y0, x0 + panel_w, y0 + panel_h,
      rgba_pack(colors.panelTop), rgba_pack(colors.panelTop), rgba_pack(colors.panelBottom), rgba_pack(colors.panelBottom))
    reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + panel_w, y0 + panel_h, rgba_pack(colors.panelBorder), metrics.radius * scale, 0, 1.0)
    reaper.ImGui_DrawList_AddRect(dl, x0 + 1 * scale, y0 + 1 * scale, x0 + panel_w - 1 * scale, y0 + panel_h - 1 * scale,
      rgba_pack(colors.panelInset), metrics.radius * scale - 1 * scale, 0, 1.0)
  end

  if reaper.ImGui_InvisibleButton then
    reaper.ImGui_InvisibleButton(ctx, '##rm_gate_panel', panel_w, panel_h)
  else
    reaper.ImGui_Dummy(ctx, panel_w, panel_h)
  end

  local meter_w = metrics.meterW * scale
  local meter_h = metrics.meterH * scale
  local meter_x = x0 + (panel_w - meter_w) * 0.5
  local meter_y = y0 + metrics.meterTop * scale

  local thresh = map.threshold ~= nil and clamp01(params.get_norm(track, fx, map.threshold)) or 0.0
  local in_pk = map.in_peak ~= nil and clamp01(params.get_norm(track, fx, map.in_peak)) or 0.0
  local close = map.gate_close ~= nil and clamp01(params.get_norm(track, fx, map.gate_close)) or 0.0
  local readout = map.threshold ~= nil and params.get_formatted(track, fx, map.threshold) or '—'

  if has_draw then
    local meter_bg = rgba_pack(colors.meterBg)
    local meter_bd = rgba_pack(colors.meterBorder)

    local left_x = meter_x
    local right_x = meter_x + meter_w * 0.5
    local mid_x = meter_x + meter_w * 0.5 - (metrics.meterDivider * 0.5) * scale

    reaper.ImGui_DrawList_AddRectFilled(dl, meter_x, meter_y, meter_x + meter_w, meter_y + meter_h, meter_bg, metrics.radius * scale)
    reaper.ImGui_DrawList_AddRect(dl, meter_x, meter_y, meter_x + meter_w, meter_y + meter_h, meter_bd, metrics.radius * scale, 0, 1.0)
    rect_multi(dl, mid_x, meter_y, mid_x + metrics.meterDivider * scale, meter_y + meter_h,
      rgba_pack(colors.dividerTop), rgba_pack(colors.dividerTop), rgba_pack(colors.dividerBottom), rgba_pack(colors.dividerBottom))
    reaper.ImGui_DrawList_AddRect(dl, mid_x, meter_y, mid_x + metrics.meterDivider * scale, meter_y + meter_h,
      rgba_pack(colors.dividerInset), 0, 0, 1.0)

    local in_h = meter_h * in_pk
    rect_multi(
      dl,
      left_x + 1 * scale,
      meter_y + meter_h - in_h,
      right_x - 2 * scale,
      meter_y + meter_h,
      rgba_pack(colors.fillInTop),
      rgba_pack(colors.fillInTop),
      rgba_pack(colors.fillInPeak),
      rgba_pack(colors.fillInPeak)
    )

    local close_h = meter_h * close
    rect_multi(
      dl,
      right_x + 2 * scale,
      meter_y,
      meter_x + meter_w - 1 * scale,
      meter_y + close_h,
      rgba_pack(colors.fillActTop),
      rgba_pack(colors.fillActTop),
      rgba_pack(colors.fillActBottom),
      rgba_pack(colors.fillActBottom)
    )

    local thumb_y = meter_y + (1.0 - thresh) * meter_h
    local thumb_w = metrics.thumbW * scale
    local thumb_h = metrics.thumbH * scale
    local thumb_x = meter_x + (meter_w - thumb_w) * 0.5
    reaper.ImGui_DrawList_AddRectFilled(dl, thumb_x, thumb_y - thumb_h * 0.5, thumb_x + thumb_w, thumb_y + thumb_h * 0.5,
      rgba_pack(colors.thumbTop), 10 * scale)
    reaper.ImGui_DrawList_AddRect(dl, thumb_x, thumb_y - thumb_h * 0.5, thumb_x + thumb_w, thumb_y + thumb_h * 0.5,
      rgba_pack(colors.thumbBorder), 10 * scale, 0, 1.0)
    reaper.ImGui_DrawList_AddRect(dl, thumb_x + 1 * scale, thumb_y - thumb_h * 0.5 + 1 * scale, thumb_x + thumb_w - 1 * scale, thumb_y + thumb_h * 0.5 - 1 * scale,
      rgba_pack(colors.thumbInset), 10 * scale - 1 * scale, 0, 1.0)

    reaper.ImGui_DrawList_AddText(dl, x0 + metrics.titleOffsetX * scale, y0 + panel_h - metrics.titleOffsetY * scale, rgba_pack(colors.title), 'Gate')

    local read_w = metrics.readoutW * scale
    local read_h = metrics.readoutH * scale
    local read_x = x0 + (panel_w - read_w) * 0.5
    local read_y = meter_y + meter_h + metrics.readoutGap * scale
    reaper.ImGui_DrawList_AddRectFilled(dl, read_x, read_y, read_x + read_w, read_y + read_h, rgba_pack(colors.readoutBg), 10 * scale)
    reaper.ImGui_DrawList_AddRect(dl, read_x, read_y, read_x + read_w, read_y + read_h, rgba_pack(colors.readoutBorder), 10 * scale, 0, 1.0)
    reaper.ImGui_DrawList_AddRect(dl, read_x + 1 * scale, read_y + 1 * scale, read_x + read_w - 1 * scale, read_y + read_h - 1 * scale,
      rgba_pack(colors.readoutInset), 10 * scale - 1 * scale, 0, 1.0)
    if reaper.ImGui_CalcTextSize then
      local tw, th = reaper.ImGui_CalcTextSize(ctx, readout or '')
      reaper.ImGui_DrawList_AddText(dl, read_x + (read_w - (tw or 0)) * 0.5, read_y + (read_h - (th or 0)) * 0.5, rgba_pack(colors.readoutText), readout or '')
    else
      reaper.ImGui_DrawList_AddText(dl, read_x + 8 * scale, read_y + 8 * scale, rgba_pack(colors.readoutText), readout or '')
    end
  end

  reaper.ImGui_Dummy(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Attack', map.attack)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Release', map.release)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  knob(ctx, track, fx, ui, scale, 'Range', map.range)

  if map.threshold ~= nil and reaper.ImGui_GetMousePos and reaper.ImGui_IsMouseDown then
    local mx, my = reaper.ImGui_GetMousePos(ctx)
    if mx >= meter_x and mx <= meter_x + meter_w and my >= meter_y and my <= meter_y + meter_h then
      if reaper.ImGui_IsMouseDown(ctx, 0) then
        local rel = compat.clamp((my - meter_y) / meter_h, 0, 1)
        params.set_norm(track, fx, map.threshold, 1.0 - rel)
      end
    end
  end
end

return panel
