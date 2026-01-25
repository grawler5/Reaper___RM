local params = require('fxpanels.params')
local compat = require('fxpanels.compat')

-- RM_Saturator - 1:1 match with Web UI (rmSatPanel).

local panel = {}

panel.meta = { win_w = 980, win_h = 620, scale_mult = 1.0 }

-- Parameter indices (match JSFX in RM_jsfx.zip)
local P = {
  drive = 0,
  punish = 1,
  style = 2,
  bias = 3,
  tone = 4,
  locut = 5,
  hp_slope = 6,
  hicut = 7,
  lp_slope = 8,
  auto = 9,
  out = 10,
  mix = 11,
}

local STYLE = { 'TAPE', 'TUBE', 'DIODE', 'TRANS', 'RECT' }
local SLOPES = { 6, 12, 18, 24, 48, 96 }

-- ReaImGui enums can be exposed either as numbers or as functions; resolve safely.
local function E(v)
  return compat.resolve_enum(v) or v
end

local function clamp01(v)
  v = tonumber(v) or 0
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function norm(track, fx, idx)
  return clamp01(params.get_norm(track, fx, idx))
end

local function set_norm(track, fx, idx, v)
  params.set_norm(track, fx, idx, clamp01(v))
end

local function bool_get(track, fx, idx)
  return norm(track, fx, idx) >= 0.5
end

local function bool_toggle(track, fx, idx)
  set_norm(track, fx, idx, bool_get(track, fx, idx) and 0 or 1)
end

local function draw_rect_mult(dl, x1, y1, x2, y2, c1, c2, c3, c4, r)
  if reaper.ImGui_DrawList_AddRectFilledMultiColor then
    reaper.ImGui_DrawList_AddRectFilledMultiColor(dl, x1, y1, x2, y2, c1, c2, c3, c4)
  else
    reaper.ImGui_DrawList_AddRectFilled(dl, x1, y1, x2, y2, c1, r or 0)
  end
end

-- A metallic dial that behaves like Web buildRmDialControl.
local function dial(ctx, track, fx, id, label, pidx, scale, value_formatter)
  local size = 86 * scale
  local pad_y = 6 * scale
  local v = norm(track, fx, pidx)
  local changed = false

  -- Label
  reaper.ImGui_Text(ctx, label)
  reaper.ImGui_Dummy(ctx, 1, pad_y)

  local x, y = compat.get_cursor_screen_pos(ctx)
  local dl = reaper.ImGui_GetWindowDrawList(ctx)
  local cx, cy = x + size * 0.5, y + size * 0.5
  local r_outer = size * 0.5
  local r_inner = r_outer - 2 * scale

  -- Interaction
  reaper.ImGui_InvisibleButton(ctx, id, size, size)
  if reaper.ImGui_IsItemActive(ctx) then
    local _, dy = reaper.ImGui_GetMouseDelta(ctx)
    if dy ~= 0 then
      v = clamp01(v - dy * 0.004)
      set_norm(track, fx, pidx, v)
      changed = true
    end
  end

  -- Face (radial-ish gradient via nested circles)
  local col_edge = reaper.ImGui_ColorConvertDouble4ToU32(0.10, 0.07, 0.05, 1.0) -- #1a120d-ish
  local col_mid = reaper.ImGui_ColorConvertDouble4ToU32(0.45, 0.45, 0.45, 1.0)
  local col_hi = reaper.ImGui_ColorConvertDouble4ToU32(0.92, 0.92, 0.92, 1.0)

  if reaper.ImGui_DrawList_AddCircleFilled then
    reaper.ImGui_DrawList_AddCircleFilled(dl, cx, cy, r_outer, col_edge)
    -- inner layers
    local steps = 10
    for i = 0, steps - 1 do
      local t = i / (steps - 1)
      local rr = r_inner * (1 - t * 0.55)
      -- blend hi->mid->edge
      local r1 = 0.92 * (1 - t) + 0.45 * t
      local g1 = 0.92 * (1 - t) + 0.45 * t
      local b1 = 0.92 * (1 - t) + 0.45 * t
      if t > 0.55 then
        local t2 = (t - 0.55) / 0.45
        r1 = 0.45 * (1 - t2) + 0.20 * t2
        g1 = 0.45 * (1 - t2) + 0.20 * t2
        b1 = 0.45 * (1 - t2) + 0.20 * t2
      end
      local col = reaper.ImGui_ColorConvertDouble4ToU32(r1, g1, b1, 1.0)
      reaper.ImGui_DrawList_AddCircleFilled(dl, cx - size * 0.08, cy - size * 0.10, rr, col)
    end
    -- rim
    if reaper.ImGui_DrawList_AddCircle then
      reaper.ImGui_DrawList_AddCircle(dl, cx, cy, r_outer - 1, col_edge, 0, 2.0 * scale)
    end
  end

  -- Needle (-135..135 deg)
  if reaper.ImGui_DrawList_AddLine then
    local ang_min = -2.35619449
    local ang_max = 2.35619449
    local ang = ang_min + (ang_max - ang_min) * v
    local nx = cx + math.cos(ang) * (r_outer * 0.72)
    local ny = cy + math.sin(ang) * (r_outer * 0.72)
    local needle = reaper.ImGui_ColorConvertDouble4ToU32(0.10, 0.07, 0.05, 1.0)
    reaper.ImGui_DrawList_AddLine(dl, cx, cy, nx, ny, needle, 3.0 * scale)
  end

  -- Value
  local txt = params.get_formatted(track, fx, pidx)
  if value_formatter then txt = value_formatter(track, fx, pidx) end
  txt = tostring(txt or '—')
  reaper.ImGui_Dummy(ctx, 1, pad_y)
  reaper.ImGui_Text(ctx, txt)

  return changed
end

local function fmt_db(track, fx, idx)
  local s = params.get_formatted(track, fx, idx)
  return tostring(s or '—')
end

local function fmt_hz(track, fx, idx)
  local s = params.get_formatted(track, fx, idx)
  return tostring(s or '—')
end

local function fmt_mix(track, fx, idx)
  -- Web UI formats raw into percent.
  local raw = params.get_raw(track, fx, idx)
  if type(raw) == 'number' then
    return string.format('%d%%', math.floor(raw + 0.5))
  end
  local n = norm(track, fx, idx)
  return string.format('%d%%', math.floor(n * 100 + 0.5))
end

local function fmt_bias(track, fx, idx)
  local raw = params.get_raw(track, fx, idx)
  if type(raw) == 'number' then
    return string.format('%.2f', raw)
  end
  local n = norm(track, fx, idx)
  -- fallback: -0.5..0.5
  return string.format('%.2f', (n * 1.0) - 0.5)
end

local function style_buttons(ctx, track, fx, scale)
  local cur_raw = params.get_raw(track, fx, P.style)
  local cur = 0
  if type(cur_raw) == 'number' then cur = math.floor(cur_raw + 0.5) end
  if cur < 0 then cur = 0 end
  if cur > #STYLE - 1 then cur = #STYLE - 1 end

  local btn_h = 32 * scale
  local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
  local gap = 8 * scale
  local btn_w = math.max(70 * scale, (avail_w - gap * (#STYLE - 1)) / #STYLE)

  for i, lab in ipairs(STYLE) do
    local on = (cur == (i - 1))
    if on then
      reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_Button), reaper.ImGui_ColorConvertDouble4ToU32(0.35, 0.24, 0.17, 1.0))
      reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonHovered), reaper.ImGui_ColorConvertDouble4ToU32(0.42, 0.30, 0.22, 1.0))
      reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonActive), reaper.ImGui_ColorConvertDouble4ToU32(0.48, 0.36, 0.26, 1.0))
    else
      reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_Button), reaper.ImGui_ColorConvertDouble4ToU32(0.29, 0.20, 0.15, 1.0))
      reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonHovered), reaper.ImGui_ColorConvertDouble4ToU32(0.33, 0.23, 0.17, 1.0))
      reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonActive), reaper.ImGui_ColorConvertDouble4ToU32(0.36, 0.26, 0.19, 1.0))
    end
    if reaper.ImGui_Button(ctx, lab, btn_w, btn_h) then
      params.set_raw(track, fx, P.style, i - 1)
    end
    reaper.ImGui_PopStyleColor(ctx, 3)
    if i < #STYLE then reaper.ImGui_SameLine(ctx, 0, gap) end
  end
end

local function mini_toggle_button(ctx, label, on, w, h, scale)
  if on then
    reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_Button), reaper.ImGui_ColorConvertDouble4ToU32(0.33, 0.22, 0.16, 1.0))
    reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonHovered), reaper.ImGui_ColorConvertDouble4ToU32(0.40, 0.28, 0.20, 1.0))
    reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonActive), reaper.ImGui_ColorConvertDouble4ToU32(0.44, 0.31, 0.22, 1.0))
  else
    reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_Button), reaper.ImGui_ColorConvertDouble4ToU32(0.29, 0.20, 0.15, 1.0))
    reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonHovered), reaper.ImGui_ColorConvertDouble4ToU32(0.33, 0.23, 0.17, 1.0))
    reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_ButtonActive), reaper.ImGui_ColorConvertDouble4ToU32(0.36, 0.26, 0.19, 1.0))
  end
  local clicked = reaper.ImGui_Button(ctx, label, w, h)
  reaper.ImGui_PopStyleColor(ctx, 3)
  return clicked
end

local function slope_combo(ctx, label, track, fx, pidx, scale)
  local raw = params.get_raw(track, fx, pidx)
  local cur = 0
  if type(raw) == 'number' then cur = math.floor(raw + 0.5) end
  if cur < 0 then cur = 0 end
  if cur > #SLOPES - 1 then cur = #SLOPES - 1 end

  reaper.ImGui_Text(ctx, label)
  local items = {}
  for i, v in ipairs(SLOPES) do items[i] = tostring(v) .. ' dB/oct' end
  local changed, idx = reaper.ImGui_Combo(ctx, '##' .. label .. '_' .. pidx, cur, table.concat(items, '\0') .. '\0')
  if changed then params.set_raw(track, fx, pidx, idx) end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state and (state.scale or state.ui_scale)) or 1.0

  -- If we can't draw, fall back to the inspector-like UI.
  if not (
    compat.has_drawlist()
    and reaper.ImGui_ColorConvertDouble4ToU32
    and (reaper.ImGui_GetCursorScreenPos or (reaper.ImGui_GetWindowPos and reaper.ImGui_GetCursorPos))
    and reaper.ImGui_GetWindowDrawList
    and reaper.ImGui_DrawList_AddRectFilled
    and reaper.ImGui_InvisibleButton
  ) then
    reaper.ImGui_Text(ctx, 'RM_Saturator')
    reaper.ImGui_Separator(ctx)
    for _, k in pairs(P) do
      local v = norm(track, fx, k)
      local changed, nv = reaper.ImGui_SliderDouble and reaper.ImGui_SliderDouble(ctx, '##p' .. k, v, 0.0, 1.0)
        or reaper.ImGui_SliderFloat(ctx, '##p' .. k, v, 0.0, 1.0)
      if changed then set_norm(track, fx, k, nv) end
    end
    return
  end

  -- Host panel background (rmSatPanel)
  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  local max_w = 900 * scale
  local max_h = 520 * scale
  local w = math.min(avail_w, max_w)
  local h = math.min(avail_h, max_h)

  -- Center (no SetCursorPos for ReaImGui 0.10.x)
  if reaper.ImGui_Dummy and reaper.ImGui_SameLine and reaper.ImGui_GetContentRegionAvail then
    local avail_w2 = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
    if type(avail_w2) == 'number' then
      local pad = (avail_w2 - w) * 0.5
      if pad > 1 then reaper.ImGui_Dummy(ctx, pad, 0); reaper.ImGui_SameLine(ctx) end
    end
  end
  local x0, y0 = compat.get_cursor_screen_pos(ctx)
  local dl = reaper.ImGui_GetWindowDrawList(ctx)

  -- Clip all drawlist primitives to the panel bounds (prevents vignette circles from bleeding
  -- outside on some ImGui backends).
  local did_clip = false
  if reaper.ImGui_DrawList_PushClipRect then
    pcall(reaper.ImGui_DrawList_PushClipRect, dl, x0, y0, x0 + w, y0 + h, true)
    did_clip = true
  end

  local r = 18 * scale
  local c_top = reaper.ImGui_ColorConvertDouble4ToU32(0.24, 0.18, 0.14, 1.0) -- #3e2f25-ish
  local c_bot = reaper.ImGui_ColorConvertDouble4ToU32(0.17, 0.12, 0.09, 1.0) -- #2b1f18-ish
  local c_bd = reaper.ImGui_ColorConvertDouble4ToU32(0, 0, 0, 0.60)
  local c_in = reaper.ImGui_ColorConvertDouble4ToU32(1, 1, 1, 0.06)
  draw_rect_mult(dl, x0, y0, x0 + w, y0 + h, c_top, c_top, c_bot, c_bot, r)
  reaper.ImGui_DrawList_AddRect(dl, x0, y0, x0 + w, y0 + h, c_bd, r, 0, 1.0)
  reaper.ImGui_DrawList_AddRect(dl, x0 + 1, y0 + 1, x0 + w - 1, y0 + h - 1, c_in, r - 1, 0, 1.0)
  -- subtle radial highlights
  if reaper.ImGui_DrawList_AddCircleFilled then
    reaper.ImGui_DrawList_AddCircleFilled(dl, x0 + w * 0.20, y0 + h * 0.20, w * 0.25, reaper.ImGui_ColorConvertDouble4ToU32(1, 1, 1, 0.06))
    reaper.ImGui_DrawList_AddCircleFilled(dl, x0 + w * 0.80, y0 + h * 0.30, w * 0.28, reaper.ImGui_ColorConvertDouble4ToU32(1, 1, 1, 0.04))
  end

  if did_clip and reaper.ImGui_DrawList_PopClipRect then
    pcall(reaper.ImGui_DrawList_PopClipRect, dl)
  end

  -- Create a child region to place widgets (so cursor advances correctly)
  reaper.ImGui_BeginChild(ctx, '##rm_sat_panel', w, h, 0, 0)
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_ItemSpacing), 10 * scale, 10 * scale)

  -- Header
  reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_Text), reaper.ImGui_ColorConvertDouble4ToU32(0.95, 0.90, 0.86, 1.0))
  reaper.ImGui_Text(ctx, 'RM SATURATOR')
  reaper.ImGui_SameLine(ctx)
  reaper.ImGui_PushStyleColor(ctx, E(reaper.ImGui_Col_Text), reaper.ImGui_ColorConvertDouble4ToU32(0.95, 0.90, 0.86, 0.70))
  reaper.ImGui_Text(ctx, 'Analog drive')
  reaper.ImGui_PopStyleColor(ctx, 1)
  reaper.ImGui_PopStyleColor(ctx, 1)

  reaper.ImGui_Dummy(ctx, 1, 6 * scale)

  -- Style row
  style_buttons(ctx, track, fx, scale)

  reaper.ImGui_Dummy(ctx, 1, 10 * scale)

  -- Main 2 blocks
  local content_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
  local gap = 14 * scale
  local block_w = (content_w - gap) * 0.5

  -- Left block
  reaper.ImGui_BeginChild(ctx, '##rm_sat_left', block_w, 0, 0, 0)
  dial(ctx, track, fx, '##drive', 'DRIVE', P.drive, scale, fmt_db)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  dial(ctx, track, fx, '##locut', 'LOCUT', P.locut, scale, fmt_hz)

  reaper.ImGui_Dummy(ctx, 1, 8 * scale)
  dial(ctx, track, fx, '##tone', 'TONE', P.tone, scale, fmt_db)

  -- Switch row
  reaper.ImGui_Dummy(ctx, 1, 8 * scale)
  local auto_on = bool_get(track, fx, P.auto)
  local pun_on = bool_get(track, fx, P.punish)
  local bw = 110 * scale
  local bh = 28 * scale
  if mini_toggle_button(ctx, 'AUTO', auto_on, bw, bh, scale) then bool_toggle(track, fx, P.auto) end
  reaper.ImGui_SameLine(ctx, 0, 10 * scale)
  if mini_toggle_button(ctx, 'PUNISH', pun_on, bw, bh, scale) then bool_toggle(track, fx, P.punish) end
  reaper.ImGui_EndChild(ctx)

  reaper.ImGui_SameLine(ctx, 0, gap)

  -- Right block
  reaper.ImGui_BeginChild(ctx, '##rm_sat_right', block_w, 0, 0, 0)
  dial(ctx, track, fx, '##out', 'OUTPUT', P.out, scale, fmt_db)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  dial(ctx, track, fx, '##hicut', 'HICUT', P.hicut, scale, fmt_hz)

  reaper.ImGui_Dummy(ctx, 1, 8 * scale)
  dial(ctx, track, fx, '##mix', 'MIX', P.mix, scale, fmt_mix)
  reaper.ImGui_SameLine(ctx, 0, 12 * scale)
  dial(ctx, track, fx, '##bias', 'BIAS', P.bias, scale, fmt_bias)
  reaper.ImGui_EndChild(ctx)

  reaper.ImGui_Dummy(ctx, 1, 12 * scale)

  -- Slopes
  slope_combo(ctx, 'HP SLOPE', track, fx, P.hp_slope, scale)
  reaper.ImGui_SameLine(ctx, 0, 14 * scale)
  slope_combo(ctx, 'LP SLOPE', track, fx, P.lp_slope, scale)

  reaper.ImGui_PopStyleVar(ctx, 1)
  reaper.ImGui_EndChild(ctx)

  -- Move cursor below the panel
  reaper.ImGui_Dummy(ctx, 1, 1)
end

return panel