local params = require('fxpanels.params')
local theme = require('fxpanels.theme')
local compat = require('fxpanels.compat')

local panel = {}

-- RM De-Esser - native ReaImGui recreation of the Web UI (rmDeesserPanel).
panel.meta = { win_w = 640, win_h = 360, scale_mult = 1.0 }

local cache = {}

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
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

local function fmt_param(track, fx, idx)
  if idx == nil then return '—' end
  local t = params.get_formatted(track, fx, idx)
  if t == nil or t == '' then return '—' end
  return t
end

local function panel_fit(ctx, scale, metrics)
  local BASE_W, BASE_H = metrics.fallbackW, metrics.fallbackH
  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  local w = BASE_W * scale
  local h = BASE_H * scale
  local fit = 1.0
  if type(avail_w) == 'number' and type(avail_h) == 'number' and avail_w > 10 and avail_h > 10 then
    fit = math.min(avail_w / w, avail_h / h)
  end
  return scale * fit, w * fit, h * fit
end

local function draw_vtrack(ctx, dl, id, x, y, w, h, value, meter, scale, metrics, colors)
  value = clamp01(value)
  meter = clamp01(meter)

  local radius = metrics.vtrackRadius or 10
  local bg = rgba_pack(colors.vtrackBg)
  local bd = rgba_pack(colors.vtrackBorder)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, radius * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, radius * scale, 0, 1.0)

  -- inner "input" meter fill (bottom-up)
  local fill = rgba_pack(colors.vtrackFill)
  local fh = h * meter
  if fh > 1 then
    local inset = metrics.attenInset or 2
    reaper.ImGui_DrawList_AddRectFilled(dl, x + inset, y + h - fh, x + w - inset, y + h - inset, fill, (radius - 2) * scale)
  end

  -- thumb
  local th = (metrics.vtrackThumbH or 14) * scale
  local ty = y + (1.0 - value) * h
  local tbg = rgba_pack(colors.vtrackThumbBg)
  local tbd = rgba_pack(colors.vtrackThumbBorder)
  local pad = (metrics.vtrackThumbPad or 10) * scale
  local tr = (metrics.vtrackThumbRadius or 7) * scale
  reaper.ImGui_DrawList_AddRectFilled(dl, x - pad, ty - th * 0.5, x + w + pad, ty + th * 0.5, tbg, tr)
  reaper.ImGui_DrawList_AddRect(dl, x - pad, ty - th * 0.5, x + w + pad, ty + th * 0.5, tbd, tr, 0, 1.0)

  compat.set_cursor_screen_pos(ctx, x, y)
  reaper.ImGui_InvisibleButton(ctx, id, w, h)
  if reaper.ImGui_IsItemActive(ctx) then
    local _, my = reaper.ImGui_GetMousePos(ctx)
    local drag_pad = (metrics.vtrackPad or 10) * scale
    local rel = compat.clamp((my - (y + drag_pad)) / math.max(1, (h - 2 * drag_pad)), 0, 1)
    return true, 1.0 - rel
  end
  return false, value
end

local function draw_atten(dl, x, y, w, h, value, scale, metrics, colors)
  value = clamp01(value)
  local radius = metrics.attenRadius or 10
  local bg = rgba_pack(colors.attenBg)
  local bd = rgba_pack(colors.attenBorder)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, radius * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, radius * scale, 0, 1.0)

  -- ATTEN fills top->down in the Web UI
  local fill = rgba_pack(colors.attenFill)
  local fh = h * value
  if fh > 1 then
    local inset = metrics.attenInset or 2
    reaper.ImGui_DrawList_AddRectFilled(dl, x + inset, y + inset, x + w - inset, y + inset + fh, fill, (radius - 2) * scale)
  end
end

local function knob(ctx, track, fx, ui, scale, id, label, idx, metrics)
  if idx == nil then
    reaper.ImGui_Text(ctx, label)
    reaper.ImGui_Dummy(ctx, metrics.knobFallbackSize * scale, metrics.knobFallbackSize * scale)
    return
  end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = fmt_param(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, id, v, scale, metrics.knobSize, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)
  local tokens = theme.tokens().panels.rmDeesser
  local metrics = tokens.metrics
  local colors = tokens.colors

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold', 'thr' } },
    freq = { patterns = { 'frequency', 'freq' } },
    range = { patterns = { 'range' } },
    ftype = { patterns = { 'filter type', 'filter mode', 'type' } },
    gr = { patterns = { 'telemetry', 'gr', 'gain reduction', 'atten' } },
  }, cache, 'rm_deesser')

  if not (compat.has_drawlist() and reaper.ImGui_InvisibleButton and reaper.ImGui_GetWindowDrawList) then
    reaper.ImGui_Text(ctx, 'RM De-Esser')
    reaper.ImGui_Separator(ctx)
    knob(ctx, track, fx, ui, scale, '##rm_de_thr', 'Threshold', map.threshold, metrics)
    reaper.ImGui_SameLine(ctx, 0, metrics.knobFallbackGap * scale)
    knob(ctx, track, fx, ui, scale, '##rm_de_freq', 'Freq', map.freq, metrics)
    reaper.ImGui_SameLine(ctx, 0, metrics.knobFallbackGap * scale)
    knob(ctx, track, fx, ui, scale, '##rm_de_range', 'Range', map.range, metrics)
    return
  end

  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)

  -- Web-like stage size, centered in the available region.
  local BASE_W, BASE_H = metrics.baseW, metrics.baseH
  local target_w = BASE_W * scale
  local target_h = BASE_H * scale
  local fit = 1.0
  if type(avail_w) == 'number' and type(avail_h) == 'number' and avail_w > 10 and avail_h > 10 then
    fit = math.min(avail_w / target_w, avail_h / target_h)
  end
  local sc = scale * fit
  local pw, ph = BASE_W * sc, BASE_H * sc

  -- Center in content region
  local start_x, start_y = compat.get_cursor_screen_pos(ctx)
  local cx = start_x + math.max(0, (avail_w - pw) * 0.5)
  local cy = start_y + math.max(0, (avail_h - ph) * 0.5)
  compat.set_cursor_screen_pos(ctx, cx, cy)

  local x0, y0 = compat.get_cursor_screen_pos(ctx)

  -- Big black panel (web has a vignette/gradient; keep solid + subtle border)
  local bg = rgba_pack(colors.panelBg)
  local bd = rgba_pack(colors.panelBorder)
  reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + pw, y0 + ph, bg, metrics.panelRadius * sc)
  reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + pw, y0 + ph, bd, metrics.panelRadius * sc, 0, 1.0)

  -- Header text
  local tc = rgba_pack(colors.headerText)
  local scb = rgba_pack(colors.headerGhost)
  reaper.ImGui_DrawList_AddText(dl, x0 + metrics.headerLeftX * sc, y0 + metrics.headerLeftY * sc, tc, 'DE-ESSER')
  reaper.ImGui_DrawList_AddText(dl, x0 + pw - metrics.headerRightPadX * sc, y0 + metrics.headerRightY * sc, scb, 'RM')

  -- Values
  local thr = map.threshold ~= nil and clamp01(params.get_norm(track, fx, map.threshold)) or 0
  local gr = map.gr ~= nil and clamp01(params.get_norm(track, fx, map.gr)) or 0

  -- Left: Threshold fader (no inner meter in web screenshot)
  local f_x = x0 + metrics.thresholdX * sc
  local f_y = y0 + metrics.thresholdY * sc
  local tr_w = metrics.thresholdTrackW * sc
  local tr_h = metrics.thresholdTrackH * sc
  reaper.ImGui_DrawList_AddText(dl, f_x + metrics.thresholdLabelOffsetX * sc, f_y + metrics.thresholdLabelOffsetY * sc, scb, 'THRESHOLD')

  -- draw track
  local tr_bg = rgba_pack(colors.trackBg)
  local tr_bd = rgba_pack(colors.trackBorder)
  reaper.ImGui_DrawList_AddRectFilled(dl, f_x, f_y, f_x + tr_w, f_y + tr_h, tr_bg, metrics.thresholdTrackRadius * sc)
  reaper.ImGui_DrawList_AddRect(dl, f_x, f_y, f_x + tr_w, f_y + tr_h, tr_bd, metrics.thresholdTrackRadius * sc, 0, 1.0)

  local thumb_h = metrics.thresholdThumbH * sc
  local ty = f_y + (1.0 - thr) * tr_h
  local tbg = rgba_pack(colors.trackThumbBg)
  local tbd = rgba_pack(colors.trackThumbBorder)
  local thumb_inset = metrics.thresholdThumbInset * sc
  reaper.ImGui_DrawList_AddRectFilled(dl, f_x + thumb_inset, ty - thumb_h * 0.5, f_x + tr_w - thumb_inset, ty + thumb_h * 0.5, tbg, (metrics.thresholdTrackRadius - 4) * sc)
  reaper.ImGui_DrawList_AddRect(dl, f_x + thumb_inset, ty - thumb_h * 0.5, f_x + tr_w - thumb_inset, ty + thumb_h * 0.5, tbd, (metrics.thresholdTrackRadius - 4) * sc, 0, 1.0)

  compat.set_cursor_screen_pos(ctx, f_x, f_y)
  reaper.ImGui_InvisibleButton(ctx, '##rm_de_thr_track', tr_w, tr_h)
  if reaper.ImGui_IsItemActive(ctx) then
    local _, my = reaper.ImGui_GetMousePos(ctx)
    local rel = compat.clamp((my - f_y) / math.max(1, tr_h), 0, 1)
    if map.threshold ~= nil then
      params.set_norm(track, fx, map.threshold, 1.0 - rel)
    end
  end
  reaper.ImGui_DrawList_AddText(dl, f_x + metrics.thresholdValueOffsetX * sc, f_y + tr_h + metrics.thresholdValueOffsetY * sc, tc, fmt_param(track, fx, map.threshold))

  -- Middle: ATTEN meter (fills top->down)
  local a_x = x0 + metrics.attenX * sc
  local a_y = y0 + metrics.attenY * sc
  local a_w = metrics.attenW * sc
  local a_h = tr_h
  draw_atten(dl, a_x, a_y, a_w, a_h, gr, sc, metrics, colors)
  reaper.ImGui_DrawList_AddText(dl, a_x + metrics.attenLabelOffsetX * sc, a_y + a_h + metrics.attenValueOffsetY * sc, scb, 'ATTEN')
  reaper.ImGui_DrawList_AddText(dl, a_x + metrics.attenLabelOffsetX * sc, a_y + a_h + metrics.attenValueOffsetY2 * sc, tc, fmt_param(track, fx, map.gr))

  -- Right: Type buttons + knobs
  local btn_y = y0 + metrics.buttonY * sc
  local btn_w, btn_h = metrics.buttonW * sc, metrics.buttonH * sc
  local btn_gap = metrics.buttonGap * sc
  local btn_x1 = x0 + pw - metrics.buttonOffsetX * sc
  local btn_x2 = btn_x1 + btn_w + btn_gap

  local type_on = map.ftype ~= nil and (params.get_norm(track, fx, map.ftype) > 0.5) or false -- true => SHELF
  local function draw_toggle(x, label, active, set_to)
    local bgc = active and rgba_pack(colors.buttonActiveBg) or rgba_pack(colors.buttonInactiveBg)
    local bdc = rgba_pack(colors.buttonBorder)
    local tcc = active and rgba_pack(colors.buttonText) or rgba_pack(colors.buttonTextMuted)
    reaper.ImGui_DrawList_AddRectFilled(dl, x, btn_y, x + btn_w, btn_y + btn_h, bgc, metrics.buttonRadius * sc)
    reaper.ImGui_DrawList_AddRect(dl, x, btn_y, x + btn_w, btn_y + btn_h, bdc, metrics.buttonRadius * sc, 0, 1.0)
    local tw, th = 0, 0
    if reaper.ImGui_CalcTextSize then tw, th = reaper.ImGui_CalcTextSize(ctx, label) end
    reaper.ImGui_DrawList_AddText(dl, x + (btn_w - tw) * 0.5, btn_y + (btn_h - th) * 0.5, tcc, label)

    compat.set_cursor_screen_pos(ctx, x, btn_y)
    reaper.ImGui_InvisibleButton(ctx, '##rm_de_type_' .. label, btn_w, btn_h)
    if reaper.ImGui_IsItemClicked(ctx) and map.ftype ~= nil then
      params.set_norm(track, fx, map.ftype, set_to)
    end
  end
  draw_toggle(btn_x1, 'BELL', not type_on, 0)
  draw_toggle(btn_x2, 'SHELF', type_on, 1)

  -- Knobs: FREQ / RANGE
  local k_y = y0 + metrics.knobY * sc
  local k_x1 = x0 + pw - metrics.knobOffsetX * sc
  local k_gap = metrics.knobGap * sc
  compat.set_cursor_screen_pos(ctx, k_x1, k_y)
  knob(ctx, track, fx, ui, sc, '##rm_de_freq', 'FREQ', map.freq, metrics)
  reaper.ImGui_SameLine(ctx, 0, k_gap)
  knob(ctx, track, fx, ui, sc, '##rm_de_range', 'RANGE', map.range, metrics)

  -- reserve / keep layout stable
  compat.set_cursor_screen_pos(ctx, start_x, start_y)
  reaper.ImGui_Dummy(ctx, avail_w, math.max(avail_h, ph))
end

return panel
