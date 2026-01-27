local compat = require('fxpanels.compat')
local params = require('fxpanels.params')

local panel = {}

panel.meta = { win_w = 920, win_h = 700, scale_mult = 1.0 }

local P = {
  locut_on = 0,
  locut_freq = 1,
  hicut_on = 2,
  hicut_freq = 3,
  band_base = 4, -- B1 On = param 4, then freq, gain, q (4 params per band)
  output = 84,
  spectrum_on = 85,
  spec_base = 86, -- 32 bins
  type_base = 118, -- 20 band types
  locut_slope = 138,
  hicut_slope = 139,
}

local TYPES = { 'Bell', 'LoShelf', 'HiShelf', 'Tilt' }
local SLOPES = { '12', '18', '24', '36' }

local function freq_to_x(freq, x0, w)
  local f = compat.clamp(freq or 20, 20, 20000)
  local lo = math.log(20)
  local hi = math.log(20000)
  local t = (math.log(f) - lo) / (hi - lo)
  return x0 + w * t
end

local function x_to_freq(x, x0, w)
  local t = (x - x0) / w
  t = compat.clamp(t, 0, 1)
  local lo = math.log(20)
  local hi = math.log(20000)
  return math.exp(lo + (hi - lo) * t)
end

local function gain_to_y(gain_db, y0, h)
  local g = compat.clamp(gain_db or 0, -18, 18)
  local t = (18 - g) / 36
  return y0 + h * t
end

local function y_to_gain(y, y0, h)
  local t = (y - y0) / h
  t = compat.clamp(t, 0, 1)
  return 18 - 36 * t
end

local function band_param(i)
  local base = P.band_base + (i - 1) * 4
  return base, base + 1, base + 2, base + 3
end

local function ensure_state(state)
  state.eq2 = state.eq2 or {}
  local s = state.eq2
  if s.sel_kind == nil then
    s.sel_kind = 'B'
    s.sel_index = 1
  end
  return s
end

local function color_u32(r, g, b, a)
  return reaper.ImGui_ColorConvertDouble4ToU32(r, g, b, a)
end

local function draw_band_list(ctx, track, fx, ui, scale, s)
  local items = {}
  items[#items+1] = { kind='LoCut', label='LoCut' }
  items[#items+1] = { kind='HiCut', label='HiCut' }
  for i = 1, 20 do
    items[#items+1] = { kind='B', index=i, label=('B'..i) }
  end

  for _, it in ipairs(items) do
    local selected = false
    if it.kind == 'LoCut' then
      selected = (s.sel_kind == 'LoCut')
    elseif it.kind == 'HiCut' then
      selected = (s.sel_kind == 'HiCut')
    else
      selected = (s.sel_kind == 'B' and s.sel_index == it.index)
    end

    local label = it.label
    if it.kind == 'B' then
      local p_on = band_param(it.index)
      local on = params.get_norm(track, fx, p_on)
      if on > 0.5 then
        label = label .. ' •'
      end
    end

    if reaper.ImGui_Selectable(ctx, label, selected) then
      if it.kind == 'B' then
        s.sel_kind = 'B'
        s.sel_index = it.index
      else
        s.sel_kind = it.kind
      end
    end
  end
end

local function slider_raw(ctx, track, fx, param, label, scale, width)
  local v, minv, maxv = params.get_raw(track, fx, param)
  local fmt = params.get_formatted(track, fx, param)
  if width then reaper.ImGui_PushItemWidth(ctx, width * scale) end
  local changed, nv = reaper.ImGui_SliderDouble(ctx, label, v, minv, maxv)
  if width then reaper.ImGui_PopItemWidth(ctx) end
  if fmt and fmt ~= '' then
    reaper.ImGui_SameLine(ctx)
    reaper.ImGui_Text(ctx, fmt)
  end
  if changed then params.set_raw(track, fx, param, nv) end
end

local function draw_controls(ctx, track, fx, ui, scale, s)
  reaper.ImGui_Text(ctx, 'Controls')
  reaper.ImGui_Separator(ctx)

  if s.sel_kind == 'LoCut' then
    local on = params.get_norm(track, fx, P.locut_on) > 0.5
    local changed
    changed, on = ui.toggle(ctx, 'LoCut', on, scale)
    if changed then params.set_norm(track, fx, P.locut_on, on and 1 or 0) end

    slider_raw(ctx, track, fx, P.locut_freq, 'Freq', scale, 320)
    local slope_raw = math.floor((params.get_raw(track, fx, P.locut_slope) or 0) + 0.5)
    local ch, idx = ui.combo(ctx, 'Slope (dB/oct)', slope_raw, SLOPES, scale, 160)
    if ch then params.set_raw(track, fx, P.locut_slope, idx) end
    return
  end

  if s.sel_kind == 'HiCut' then
    local on = params.get_norm(track, fx, P.hicut_on) > 0.5
    local changed
    changed, on = ui.toggle(ctx, 'HiCut', on, scale)
    if changed then params.set_norm(track, fx, P.hicut_on, on and 1 or 0) end

    slider_raw(ctx, track, fx, P.hicut_freq, 'Freq', scale, 320)
    local slope_raw = math.floor((params.get_raw(track, fx, P.hicut_slope) or 0) + 0.5)
    local ch, idx = ui.combo(ctx, 'Slope (dB/oct)', slope_raw, SLOPES, scale, 160)
    if ch then params.set_raw(track, fx, P.hicut_slope, idx) end
    return
  end

  local i = s.sel_index or 1
  local p_on, p_freq, p_gain, p_q = band_param(i)
  local p_type = P.type_base + (i - 1)

  local on = params.get_norm(track, fx, p_on) > 0.5
  local changed
  changed, on = ui.toggle(ctx, 'Band ' .. i .. ' enabled', on, scale)
  if changed then params.set_norm(track, fx, p_on, on and 1 or 0) end

  local t_raw = math.floor((params.get_raw(track, fx, p_type) or 0) + 0.5)
  local ch, new_t = ui.combo(ctx, 'Type', t_raw, TYPES, scale, 180)
  if ch then params.set_raw(track, fx, p_type, new_t) end

  slider_raw(ctx, track, fx, p_freq, 'Freq', scale, 360)
  slider_raw(ctx, track, fx, p_gain, 'Gain (dB)', scale, 360)
  slider_raw(ctx, track, fx, p_q, 'Q', scale, 360)

  reaper.ImGui_Dummy(ctx, 1, 6 * scale)
  if reaper.ImGui_Button(ctx, '0 dB') then
    params.set_raw(track, fx, p_gain, 0.0)
  end
  reaper.ImGui_SameLine(ctx)
  if reaper.ImGui_Button(ctx, 'Add band') then
    for b = 1, 20 do
      local b_on = params.get_norm(track, fx, band_param(b))
      if b_on <= 0.5 then
        params.set_norm(track, fx, band_param(b), 1)
        s.sel_kind = 'B'
        s.sel_index = b
        break
      end
    end
  end
end

local function draw_graph(ctx, track, fx, scale, s)
  local draw_ok = compat.has_drawlist()
  local avail_w, avail_h = reaper.ImGui_GetContentRegionAvail(ctx)
  local w = math.max(420 * scale, (avail_w or 700) - 10 * scale)
  local h = 260 * scale

  local x0, y0 = reaper.ImGui_GetCursorScreenPos(ctx)
  reaper.ImGui_InvisibleButton(ctx, '##eq2_graph', w, h)
  local hovered = reaper.ImGui_IsItemHovered(ctx)
  local active = reaper.ImGui_IsItemActive(ctx)

  if not draw_ok then
    reaper.ImGui_Text(ctx, 'Graph requires drawlist support (ReaImGui).')
    return
  end

  local draw = reaper.ImGui_GetWindowDrawList(ctx)
  local bg = color_u32(0.10, 0.11, 0.13, 1.0)
  local grid = color_u32(0.18, 0.19, 0.22, 1.0)
  local line = color_u32(0.70, 0.78, 0.90, 1.0)
  local pt = color_u32(0.92, 0.82, 0.68, 1.0)
  local pt_sel = color_u32(0.98, 0.62, 0.32, 1.0)

  reaper.ImGui_DrawList_AddRectFilled(draw, x0, y0, x0 + w, y0 + h, bg)
  reaper.ImGui_DrawList_AddRect(draw, x0, y0, x0 + w, y0 + h, grid)

  -- vertical freq grid
  local freqs = { 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000 }
  for _, f in ipairs(freqs) do
    local x = freq_to_x(f, x0, w)
    reaper.ImGui_DrawList_AddLine(draw, x, y0, x, y0 + h, grid)
  end

  -- horizontal gain grid
  for g = -18, 18, 6 do
    local y = gain_to_y(g, y0, h)
    reaper.ImGui_DrawList_AddLine(draw, x0, y, x0 + w, y, grid)
  end

  -- spectrum
  local spec_on = params.get_norm(track, fx, P.spectrum_on) > 0.5
  if spec_on then
    local pts = {}
    for i = 0, 31 do
      local v = params.get_norm(track, fx, P.spec_base + i)
      local xx = x0 + w * (i / 31)
      local yy = y0 + h * (1.0 - compat.clamp(v, 0, 1))
      pts[#pts + 1] = xx
      pts[#pts + 1] = yy
    end
    local col = color_u32(0.30, 0.60, 0.95, 0.35)
    if reaper.ImGui_DrawList_AddPolyline and reaper.new_array then
      local arr = reaper.new_array(#pts)
      for i = 1, #pts do
        arr[i] = pts[i]
      end
      reaper.ImGui_DrawList_AddPolyline(draw, arr, col, false, 2.0)
    else
      for i = 1, (#pts - 2), 2 do
        reaper.ImGui_DrawList_AddLine(draw, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], col, 2.0)
      end
    end
  end

  -- points
  local nearest_i = nil
  local nearest_d = 1e9
  local mx, my = reaper.ImGui_GetMousePos(ctx)

  for i = 1, 20 do
    local p_on, p_freq, p_gain = band_param(i)
    local on = params.get_norm(track, fx, p_on) > 0.5
    if on then
      local f = params.get_raw(track, fx, p_freq)
      local g = params.get_raw(track, fx, p_gain)
      local x = freq_to_x(f, x0, w)
      local y = gain_to_y(g, y0, h)
      local sel = (s.sel_kind == 'B' and s.sel_index == i)
      local col = sel and pt_sel or pt
      reaper.ImGui_DrawList_AddCircleFilled(draw, x, y, 5 * scale, col)
      local d = (mx - x) * (mx - x) + (my - y) * (my - y)
      if d < nearest_d then
        nearest_d = d
        nearest_i = i
      end
    end
  end

  -- click to select
  if hovered and reaper.ImGui_IsMouseClicked(ctx, 0) and nearest_i ~= nil then
    if nearest_d <= (12 * scale) * (12 * scale) then
      s.sel_kind = 'B'
      s.sel_index = nearest_i
    end
  end

  -- drag selected band
  if active and s.sel_kind == 'B' then
    local i = s.sel_index or 1
    local _, p_freq, p_gain = band_param(i)
    local f = x_to_freq(mx, x0, w)
    local g = y_to_gain(my, y0, h)
    params.set_raw(track, fx, p_freq, f)
    params.set_raw(track, fx, p_gain, g)
  end

  -- wheel adjusts Q
  if hovered and reaper.ImGui_GetMouseWheel ~= nil and s.sel_kind == 'B' then
    local wheel = reaper.ImGui_GetMouseWheel(ctx)
    if wheel and wheel ~= 0 then
      local i = s.sel_index or 1
      local _, _, _, p_q = band_param(i)
      local q, minq, maxq = params.get_raw(track, fx, p_q)
      local step = (maxq - minq) * 0.02
      params.set_raw(track, fx, p_q, q + wheel * step)
    end
  end
end

function panel.render(ctx, track, fx, ui, state)
  local scale = (state.ui_scale or state.scale or 1.0) * (panel.meta.scale_mult or 1.0)
  local s = ensure_state(state)

  -- top bar
  local out_p = P.output
  local out_v = params.get_norm(track, fx, out_p)
  local out_fmt = params.get_formatted(track, fx, out_p)

  reaper.ImGui_Text(ctx, 'R M  E Q 2')
  reaper.ImGui_SameLine(ctx)
  reaper.ImGui_Text(ctx, '   Output: ' .. tostring(out_fmt or ''))
  reaper.ImGui_Separator(ctx)

  -- Layout: band list (left) + graph/controls (right)
  -- NOTE: ReaImGui 0.10.0.2 can assert on TableSetupColumn sizing; use child layout instead.
  local spacing = 12 * scale
  local list_w = 180 * scale

  do
    local opened, is_child = ui._begin_child(ctx, '##eq2_list', list_w, 0, true)
    if opened then
      draw_band_list(ctx, track, fx, ui, scale, s)
    end
    if is_child then reaper.ImGui_EndChild(ctx) end
  end

  reaper.ImGui_SameLine(ctx, 0, spacing)

  -- Right pane takes remaining space
  do
    local opened, is_child = ui._begin_child(ctx, '##eq2_main', 0, 0, false)
    if opened then
      draw_graph(ctx, track, fx, scale, s)
      reaper.ImGui_Dummy(ctx, 1, 10 * scale)
      draw_controls(ctx, track, fx, ui, scale, s)
    end
    if is_child then reaper.ImGui_EndChild(ctx) end
  end

  -- bottom bar
  reaper.ImGui_Separator(ctx)
  local spec = params.get_norm(track, fx, P.spectrum_on) > 0.5
  local changed
  changed, spec = ui.toggle(ctx, 'Spectrum', spec, scale)
  if changed then params.set_norm(track, fx, P.spectrum_on, spec and 1 or 0) end
  reaper.ImGui_SameLine(ctx)
  reaper.ImGui_PushItemWidth(ctx, 200 * scale)
  local ch, nv = reaper.ImGui_SliderDouble(ctx, 'Output', out_v, 0.0, 1.0)
  reaper.ImGui_PopItemWidth(ctx)
  if ch then params.set_norm(track, fx, out_p, nv) end
end

return panel
