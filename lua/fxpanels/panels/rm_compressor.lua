local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

local panel = {}

-- RM Compressor - native ReaImGui recreation of the Web UI (rmCompPanel).
panel.meta = { win_w = 900, win_h = 620, scale_mult = 1.0 }

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

local function draw_vtrack(ctx, dl, id, x, y, w, h, value, meter, thumb_w, scale)
  value = clamp01(value)
  meter = clamp01(meter)

  -- Track
  local bg = color_u32(0.10, 0.10, 0.11, 1.0)
  local bd = color_u32(0, 0, 0, 0.65)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 10 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 10 * scale, 0, 1.0)

  -- Meter fill (bottom-up)
  local fill = color_u32(0.32, 0.90, 0.56, 0.95)
  local fh = h * meter
  if fh > 1 then
    reaper.ImGui_DrawList_AddRectFilled(dl, x + 2, y + h - fh, x + w - 2, y + h - 2, fill, 8 * scale)
  end

  -- Thumb
  local ty = y + (1.0 - value) * h
  local tw = thumb_w or (w + 22 * scale)
  local th = 12 * scale
  local tx = x + (w - tw) * 0.5
  local tbg = color_u32(0.18, 0.19, 0.22, 1.0)
  local tbd = color_u32(0, 0, 0, 0.75)
  reaper.ImGui_DrawList_AddRectFilled(dl, tx, ty - th * 0.5, tx + tw, ty + th * 0.5, tbg, 6 * scale)
  reaper.ImGui_DrawList_AddRect(dl, tx, ty - th * 0.5, tx + tw, ty + th * 0.5, tbd, 6 * scale, 0, 1.0)

  -- Interaction
  compat.set_cursor_screen_pos(ctx, x, y)
  reaper.ImGui_InvisibleButton(ctx, id, w, h)
  if reaper.ImGui_IsItemActive(ctx) then
    local mx, my = reaper.ImGui_GetMousePos(ctx)
    local rel = compat.clamp((my - y) / h, 0, 1)
    return true, 1.0 - rel
  end

  return false, value
end

local function draw_gr_meter(dl, x, y, w, h, value, scale)
  local v = clamp01(value)
  local bg = color_u32(0.10, 0.10, 0.11, 1.0)
  local bd = color_u32(0, 0, 0, 0.65)
  reaper.ImGui_DrawList_AddRectFilled(dl, x, y, x + w, y + h, bg, 10 * scale)
  reaper.ImGui_DrawList_AddRect(dl, x, y, x + w, y + h, bd, 10 * scale, 0, 1.0)

  local fill = color_u32(0.95, 0.18, 0.18, 0.80)
  local fh = h * v
  if fh > 1 then
    reaper.ImGui_DrawList_AddRectFilled(dl, x + 2, y + 2, x + w - 2, y + 2 + fh, fill, 8 * scale)
  end
end

local function hslider_row(ctx, track, fx, idx, label, scale, width)
  local w = (width or 220) * scale
  reaper.ImGui_Text(ctx, label)
  reaper.ImGui_SameLine(ctx, 120 * scale)
  reaper.ImGui_PushItemWidth(ctx, w)
  local v = idx ~= nil and clamp01(params.get_norm(track, fx, idx)) or 0.0
  local changed, nv
  if reaper.ImGui_SliderDouble ~= nil then
    changed, nv = reaper.ImGui_SliderDouble(ctx, '##rm_comp_' .. label, v, 0.0, 1.0)
  else
    changed, nv = reaper.ImGui_SliderFloat(ctx, '##rm_comp_' .. label, v, 0.0, 1.0)
  end
  reaper.ImGui_PopItemWidth(ctx)
  reaper.ImGui_SameLine(ctx)
  reaper.ImGui_Text(ctx, fmt_param(track, fx, idx))
  if changed and idx ~= nil then
    params.set_norm(track, fx, idx, nv)
  end
end

local function toggle_btn(ui, ctx, label, on, scale)
  if on then
    return ui.button_primary(ctx, label, scale, 0, 32)
  end
  return ui.button_secondary(ctx, label, scale, 0, 32)
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)

  local map = params.build_map(track, fx, {
    threshold = { patterns = { 'threshold', 'thresh' } },
    attack = { patterns = { 'attack' } },
    release = { patterns = { 'release' } },
    knee = { patterns = { 'knee' } },
    ratio = { patterns = { 'ratio' } },
    detect = { patterns = { 'detect', 'detector', 'side chain', 'sidechain', 'source' } },
    lp = { patterns = { 'lp', 'low pass', 'lowpass' } },
    hp = { patterns = { 'hp', 'high pass', 'highpass' } },
    bpm_sync = { patterns = { 'bpm sync', 'tempo sync', 'sync' } },
    auto_makeup = { patterns = { 'auto makeup', 'makeup' } },
    limit_out = { patterns = { 'limit out', 'output limit' } },
    out_gain = { patterns = { 'output gain', 'out gain', 'output' } },
    in_peak = { patterns = { 'telemetry', 'input peak', 'in peak' } },
    out_peak = { patterns = { 'telemetry', 'out peak' } },
    gr = { patterns = { 'telemetry', 'gr', 'gain reduction' } },
  }, cache, 'rm_compressor')

  -- Fallback for old ReaImGui builds without drawlist.
  if not (compat.has_drawlist() and reaper.ImGui_InvisibleButton and reaper.ImGui_GetWindowDrawList) then
    reaper.ImGui_Text(ctx, 'RM Compressor')
    reaper.ImGui_Separator(ctx)
    hslider_row(ctx, track, fx, map.threshold, 'Threshold', scale)
    hslider_row(ctx, track, fx, map.attack, 'Attack', scale)
    hslider_row(ctx, track, fx, map.release, 'Release', scale)
    hslider_row(ctx, track, fx, map.ratio, 'Ratio', scale)
    hslider_row(ctx, track, fx, map.knee, 'Knee', scale)
    hslider_row(ctx, track, fx, map.lp, 'LP', scale)
    hslider_row(ctx, track, fx, map.hp, 'HP', scale)
    return
  end

  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  local base_w = 860 * scale
  local base_h = 560 * scale
  local fit = 1.0
  if type(avail_w) == 'number' and type(avail_h) == 'number' and avail_w > 10 and avail_h > 10 then
    fit = math.min(avail_w / base_w, avail_h / base_h)
  end
  local sc = scale * fit

  local col_gap = 14 * sc
  local col_l = 280 * sc
  local col_m = 320 * sc
  local col_r = 220 * sc

  local dl = reaper.ImGui_GetWindowDrawList(ctx)

  -- --- Left: THRESHOLD card ---
  local opened, is_child, scope = ui.card_begin(ctx, '##rm_comp_thresh', sc, col_l, 0)
  if opened then
    ui.section_title(ctx, 'THRESHOLD')
    reaper.ImGui_Separator(ctx)

    local x0, y0 = compat.get_cursor_screen_pos(ctx)
    local card_w = col_l
    local track_h = 260 * sc
    local track_w = 54 * sc
    local gr_w = 22 * sc

    local t_val = map.threshold ~= nil and clamp01(params.get_norm(track, fx, map.threshold)) or 0
    local in_val = map.in_peak ~= nil and clamp01(params.get_norm(track, fx, map.in_peak)) or 0
    local gr_val = map.gr ~= nil and clamp01(params.get_norm(track, fx, map.gr)) or 0

    local tx = x0 + 20 * sc
    local ty = y0 + 18 * sc
    local gx = tx + track_w + 12 * sc
    local gy = ty

    local changed, nv = draw_vtrack(ctx, dl, '##rm_comp_threshold_track', tx, ty, track_w, track_h, t_val, in_val, track_w + 24 * sc, sc)
    if changed and map.threshold ~= nil then
      params.set_norm(track, fx, map.threshold, nv)
    end
    draw_gr_meter(dl, gx, gy, gr_w, track_h, gr_val, sc)

    -- Readouts (In / Threshold / GR)
    compat.set_cursor_screen_pos(ctx, x0, ty + track_h + 10 * sc)
    reaper.ImGui_PushItemWidth(ctx, card_w - 20 * sc)
    reaper.ImGui_Text(ctx, fmt_param(track, fx, map.in_peak))
    reaper.ImGui_SameLine(ctx, 0, 12 * sc)
    reaper.ImGui_Text(ctx, fmt_param(track, fx, map.threshold))
    reaper.ImGui_SameLine(ctx, 0, 12 * sc)
    reaper.ImGui_Text(ctx, fmt_param(track, fx, map.gr))
    reaper.ImGui_PopItemWidth(ctx)

    -- Detect row (best-effort: toggle param if it exists)
    reaper.ImGui_Dummy(ctx, 0, 10 * sc)
    local det_on = (map.detect ~= nil) and (clamp01(params.get_norm(track, fx, map.detect)) > 0.5) or false
    if map.detect ~= nil then
      if toggle_btn(ui, ctx, det_on and 'Returns' or 'Main', det_on, sc) then
        params.set_norm(track, fx, map.detect, det_on and 0 or 1)
      end
      reaper.ImGui_SameLine(ctx, 0, 8 * sc)
    end
    ui.button_ghost(ctx, 'Returns', sc, 0, 32) -- placeholder (track menu is a Web-only feature)

    compat.set_cursor_screen_pos(ctx, x0, y0)
    reaper.ImGui_Dummy(ctx, card_w, track_h + 90 * sc)
  end
  ui.card_end(ctx, is_child, scope)

  reaper.ImGui_SameLine(ctx, 0, col_gap)

  -- --- Mid: ENVELOPE + FILTER + OPTIONS ---
  local opened2, is_child2, scope2 = ui.card_begin(ctx, '##rm_comp_mid', sc, col_m, 0)
  if opened2 then
    ui.section_title(ctx, 'ENVELOPE')
    reaper.ImGui_Separator(ctx)
    hslider_row(ctx, track, fx, map.attack, 'Attack', sc, 190)
    hslider_row(ctx, track, fx, map.release, 'Release', sc, 190)
    hslider_row(ctx, track, fx, map.ratio, 'Ratio', sc, 190)
    hslider_row(ctx, track, fx, map.knee, 'Knee', sc, 190)

    reaper.ImGui_Dummy(ctx, 0, 10 * sc)
    ui.section_title(ctx, 'FILTER')
    reaper.ImGui_Separator(ctx)
    hslider_row(ctx, track, fx, map.lp, 'LP', sc, 190)
    hslider_row(ctx, track, fx, map.hp, 'HP', sc, 190)

    reaper.ImGui_Dummy(ctx, 0, 12 * sc)
    local sync_on = (map.bpm_sync ~= nil) and (clamp01(params.get_norm(track, fx, map.bpm_sync)) > 0.5) or false
    local makeup_on = (map.auto_makeup ~= nil) and (clamp01(params.get_norm(track, fx, map.auto_makeup)) > 0.5) or false
    local limit_on = (map.limit_out ~= nil) and (clamp01(params.get_norm(track, fx, map.limit_out)) > 0.5) or false

    if map.bpm_sync ~= nil and toggle_btn(ui, ctx, 'BPM Sync', sync_on, sc) then
      params.set_norm(track, fx, map.bpm_sync, sync_on and 0 or 1)
    end
    reaper.ImGui_SameLine(ctx, 0, 8 * sc)
    if map.auto_makeup ~= nil and toggle_btn(ui, ctx, 'Auto Makeup', makeup_on, sc) then
      params.set_norm(track, fx, map.auto_makeup, makeup_on and 0 or 1)
    end
    reaper.ImGui_SameLine(ctx, 0, 8 * sc)
    if map.limit_out ~= nil and toggle_btn(ui, ctx, 'Limit Out', limit_on, sc) then
      params.set_norm(track, fx, map.limit_out, limit_on and 0 or 1)
    end
  end
  ui.card_end(ctx, is_child2, scope2)

  reaper.ImGui_SameLine(ctx, 0, col_gap)

  -- --- Right: OUTPUT card ---
  local opened3, is_child3, scope3 = ui.card_begin(ctx, '##rm_comp_out', sc, col_r, 0)
  if opened3 then
    ui.section_title(ctx, 'OUTPUT')
    reaper.ImGui_Separator(ctx)

    local x0, y0 = compat.get_cursor_screen_pos(ctx)
    local track_h = 320 * sc
    local track_w = 54 * sc

    local out_val = map.out_gain ~= nil and clamp01(params.get_norm(track, fx, map.out_gain)) or 0
    local out_pk = map.out_peak ~= nil and clamp01(params.get_norm(track, fx, map.out_peak)) or 0

    local tx = x0 + 26 * sc
    local ty = y0 + 18 * sc

    local changed, nv = draw_vtrack(ctx, dl, '##rm_comp_out_track', tx, ty, track_w, track_h, out_val, out_pk, track_w + 24 * sc, sc)
    if changed and map.out_gain ~= nil then
      params.set_norm(track, fx, map.out_gain, nv)
    end

    compat.set_cursor_screen_pos(ctx, x0, ty + track_h + 10 * sc)
    reaper.ImGui_Text(ctx, fmt_param(track, fx, map.out_gain))

    compat.set_cursor_screen_pos(ctx, x0, y0)
    reaper.ImGui_Dummy(ctx, col_r, track_h + 70 * sc)
  end
  ui.card_end(ctx, is_child3, scope3)
end

return panel
