local params = require('fxpanels.params')
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

local function color_u32(r, g, b, a)
  return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
end

local function fmt_param(track, fx, idx)
  if idx == nil then return '—' end
  local t = params.get_formatted(track, fx, idx)
  if t == nil or t == '' then return '—' end
  return t
end

local function panel_fit(ctx, scale)
  local BASE_W, BASE_H = 640, 320
  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  local w = BASE_W * scale
  local h = BASE_H * scale
  local fit = 1.0
  if type(avail_w) == 'number' and type(avail_h) == 'number' and avail_w > 10 and avail_h > 10 then
    fit = math.min(avail_w / w, avail_h / h)
  end
  return scale * fit, w * fit, h * fit
end

local function draw_vtrack(ctx, dl, id, x, y, w, h, value, meter, scale)
  value = clamp01(value)
  meter = clamp01(meter)

  local bg = color_u32(0.11, 0.11, 0.12, 1.0)
  local bd = color_u32(0, 0, 0, 0.70)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 10 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 10 * scale, 0, 1.0)

  -- inner "input" meter fill (bottom-up)
  local fill = color_u32(0.35, 0.95, 0.55, 0.95)
  local fh = h * meter
  if fh > 1 then
    reaper.ImGui_DrawList_AddRectFilled(dl, x + 2, y + h - fh, x + w - 2, y + h - 2, fill, 8 * scale)
  end

  -- thumb
  local th = 14 * scale
  local ty = y + (1.0 - value) * h
  local tbg = color_u32(0.20, 0.20, 0.23, 1.0)
  local tbd = color_u32(0, 0, 0, 0.80)
  reaper.ImGui_DrawList_AddRectFilled(dl, x - 10 * scale, ty - th * 0.5, x + w + 10 * scale, ty + th * 0.5, tbg, 7 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x - 10 * scale, ty - th * 0.5, x + w + 10 * scale, ty + th * 0.5, tbd, 7 * scale, 0, 1.0)

  compat.set_cursor_screen_pos(ctx, x, y)
  reaper.ImGui_InvisibleButton(ctx, id, w, h)
  if reaper.ImGui_IsItemActive(ctx) then
    local _, my = reaper.ImGui_GetMousePos(ctx)
    local pad = 10 * scale
    local rel = compat.clamp((my - (y + pad)) / math.max(1, (h - 2 * pad)), 0, 1)
    return true, 1.0 - rel
  end
  return false, value
end

local function draw_atten(dl, x, y, w, h, value, scale)
  value = clamp01(value)
  local bg = color_u32(0.11, 0.11, 0.12, 1.0)
  local bd = color_u32(0, 0, 0, 0.70)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 10 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 10 * scale, 0, 1.0)

  -- ATTEN fills top->down in the Web UI
  local fill = color_u32(0.95, 0.18, 0.18, 0.85)
  local fh = h * value
  if fh > 1 then
    reaper.ImGui_DrawList_AddRectFilled(dl, x + 2, y + 2, x + w - 2, y + 2 + fh, fill, 8 * scale)
  end
end

local function knob(ctx, track, fx, ui, scale, id, label, idx)
  if idx == nil then
    reaper.ImGui_Text(ctx, label)
    reaper.ImGui_Dummy(ctx, 60 * scale, 60 * scale)
    return
  end
  local v = clamp01(params.get_norm(track, fx, idx))
  local fmt = fmt_param(track, fx, idx)
  local changed, nv = ui.knob_norm(ctx, id, v, scale, 64, label, fmt)
  if changed then params.set_norm(track, fx, idx, nv) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

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
    knob(ctx, track, fx, ui, scale, '##rm_de_thr', 'Threshold', map.threshold)
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
    knob(ctx, track, fx, ui, scale, '##rm_de_freq', 'Freq', map.freq)
    reaper.ImGui_SameLine(ctx, 0, 12 * scale)
    knob(ctx, track, fx, ui, scale, '##rm_de_range', 'Range', map.range)
    return
  end

  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)

  -- Web-like stage size, centered in the available region.
  local BASE_W, BASE_H = 900, 320
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
  local bg = color_u32(0.06, 0.06, 0.07, 1.0)
  local bd = color_u32(0, 0, 0, 0.70)
  reaper.ImGui_DrawList_AddRectFilled(dl, x0, y0, x0 + pw, y0 + ph, bg, 18 * sc)
  reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + pw, y0 + ph, bd, 18 * sc, 0, 1.0)

  -- Header text
  local tc = color_u32(0.92, 0.92, 0.92, 0.92)
  local scb = color_u32(0.92, 0.92, 0.92, 0.35)
  reaper.ImGui_DrawList_AddText(dl, x0 + 36 * sc, y0 + 22 * sc, tc, 'DE-ESSER')
  reaper.ImGui_DrawList_AddText(dl, x0 + pw - 44 * sc, y0 + 24 * sc, scb, 'RM')

  -- Values
  local thr = map.threshold ~= nil and clamp01(params.get_norm(track, fx, map.threshold)) or 0
  local gr = map.gr ~= nil and clamp01(params.get_norm(track, fx, map.gr)) or 0

  -- Left: Threshold fader (no inner meter in web screenshot)
  local f_x = x0 + 70 * sc
  local f_y = y0 + 78 * sc
  local tr_w = 70 * sc
  local tr_h = 200 * sc
  reaper.ImGui_DrawList_AddText(dl, f_x - 6 * sc, f_y - 28 * sc, scb, 'THRESHOLD')

  -- draw track
  local tr_bg = color_u32(0.09, 0.09, 0.10, 1.0)
  local tr_bd = color_u32(0, 0, 0, 0.65)
  reaper.ImGui_DrawList_AddRectFilled(dl, f_x, f_y, f_x + tr_w, f_y + tr_h, tr_bg, 14 * sc)
  reaper.ImGui_DrawList_AddRect(dl, f_x, f_y, f_x + tr_w, f_y + tr_h, tr_bd, 14 * sc, 0, 1.0)

  local thumb_h = 18 * sc
  local ty = f_y + (1.0 - thr) * tr_h
  local tbg = color_u32(0.22, 0.22, 0.24, 1.0)
  local tbd = color_u32(0, 0, 0, 0.80)
  reaper.ImGui_DrawList_AddRectFilled(dl, f_x + 8 * sc, ty - thumb_h * 0.5, f_x + tr_w - 8 * sc, ty + thumb_h * 0.5, tbg, 10 * sc)
  reaper.ImGui_DrawList_AddRect(dl, f_x + 8 * sc, ty - thumb_h * 0.5, f_x + tr_w - 8 * sc, ty + thumb_h * 0.5, tbd, 10 * sc, 0, 1.0)

  compat.set_cursor_screen_pos(ctx, f_x, f_y)
  reaper.ImGui_InvisibleButton(ctx, '##rm_de_thr_track', tr_w, tr_h)
  if reaper.ImGui_IsItemActive(ctx) then
    local _, my = reaper.ImGui_GetMousePos(ctx)
    local rel = compat.clamp((my - f_y) / math.max(1, tr_h), 0, 1)
    if map.threshold ~= nil then
      params.set_norm(track, fx, map.threshold, 1.0 - rel)
    end
  end
  reaper.ImGui_DrawList_AddText(dl, f_x + 6 * sc, f_y + tr_h + 12 * sc, tc, fmt_param(track, fx, map.threshold))

  -- Middle: ATTEN meter (fills top->down)
  local a_x = x0 + 210 * sc
  local a_y = f_y
  local a_w = 54 * sc
  local a_h = tr_h
  draw_atten(dl, a_x, a_y, a_w, a_h, gr, sc)
  reaper.ImGui_DrawList_AddText(dl, a_x + 2 * sc, a_y + a_h + 12 * sc, scb, 'ATTEN')
  reaper.ImGui_DrawList_AddText(dl, a_x + 2 * sc, a_y + a_h + 28 * sc, tc, fmt_param(track, fx, map.gr))

  -- Right: Type buttons + knobs
  local btn_y = y0 + 84 * sc
  local btn_w, btn_h = 120 * sc, 44 * sc
  local btn_gap = 14 * sc
  local btn_x1 = x0 + pw - 320 * sc
  local btn_x2 = btn_x1 + btn_w + btn_gap

  local type_on = map.ftype ~= nil and (params.get_norm(track, fx, map.ftype) > 0.5) or false -- true => SHELF
  local function draw_toggle(x, label, active, set_to)
    local bgc = active and color_u32(0.18, 0.18, 0.20, 1.0) or color_u32(0.10, 0.10, 0.11, 1.0)
    local bdc = color_u32(0, 0, 0, 0.55)
    local tcc = color_u32(0.92, 0.92, 0.92, active and 0.95 or 0.85)
    reaper.ImGui_DrawList_AddRectFilled(dl, x, btn_y, x + btn_w, btn_y + btn_h, bgc, 14 * sc)
    reaper.ImGui_DrawList_AddRect(dl, x, btn_y, x + btn_w, btn_y + btn_h, bdc, 14 * sc, 0, 1.0)
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
  local k_y = y0 + 160 * sc
  local k_x1 = x0 + pw - 360 * sc
  local k_gap = 150 * sc
  compat.set_cursor_screen_pos(ctx, k_x1, k_y)
  knob(ctx, track, fx, ui, sc, '##rm_de_freq', 'FREQ', map.freq)
  reaper.ImGui_SameLine(ctx, 0, k_gap)
  knob(ctx, track, fx, ui, sc, '##rm_de_range', 'RANGE', map.range)

  -- reserve / keep layout stable
  compat.set_cursor_screen_pos(ctx, start_x, start_y)
  reaper.ImGui_Dummy(ctx, avail_w, math.max(avail_h, ph))
end

return panel
