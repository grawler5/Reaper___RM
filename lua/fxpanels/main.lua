local registry = require('fxpanels.registry')
local compat = require('fxpanels.compat')
local ui = require('fxpanels.ui')
local params = require('fxpanels.params')
local presets_store = require('fxpanels.presets')
local theme = require('fxpanels.theme')

local main = {}

local EXT_SECTION = 'ReaperRM'
local HB_STALE_SECONDS = 2.0
local DEFAULT_SCALE = 1.0

local function now()
  if reaper.time_precise then return reaper.time_precise() end
  return os.clock()
end

local function ext_get(key)
  return reaper.GetExtState(EXT_SECTION, key)
end

local function ext_set(key, value, persist)
  reaper.SetExtState(EXT_SECTION, key, tostring(value or ''), persist and true or false)
end

local function hb_write(key)
  ext_set(key, string.format('%.6f', now()), false)
end

local function hb_alive(hb)
  local t = tonumber(hb or '')
  if not t then return false end
  return (now() - t) <= HB_STALE_SECONDS
end

local function panels_enabled()
  if tostring(ext_get('FxReplaceEnabled')) ~= '1' then
    return false
  end
  return hb_alive(ext_get('ControlHB'))
end

local function should_stop()
  return tostring(ext_get('FxPanelsStop')) == '1'
end

local function E(v)
  return compat.resolve_enum(v) or v
end

local function push_theme(ctx, scale)
  return theme.push(ctx, scale)
end

local function pop_theme(ctx, sv, sc)
  return theme.pop(ctx, sv, sc)
end

-- Context guard (macOS + ReaImGui 0.10.x)
--
-- On macOS ReaImGui can occasionally end up with an invalid context after OS-level
-- minimize/close or after a script error leaves the context in a bad state.
-- If we call any ImGui_* function with an invalid ctx, ReaImGui throws assertions.
local function ctx_ok(ctx)
  if not ctx then return false end
  local ok = pcall(reaper.ImGui_GetTime, ctx)
  return ok
end

local function create_ctx()
  return reaper.ImGui_CreateContext('ReaperRM FX Panels')
end

local function ensure_ctx(state)
  -- If ctx becomes invalid, recreate and reset per-window size init.
  if ctx_ok(state.ctx) then return true end
  if state.ctx then pcall(reaper.ImGui_DestroyContext, state.ctx) end
  state.ctx = create_ctx()
  for _, ws in pairs(state.windows or {}) do
    ws._size_inited = nil
  end
  return ctx_ok(state.ctx)
end

local function get_track_name(track)
  local ok, name = reaper.GetTrackName(track)
  if ok and type(name) == 'string' and name ~= '' then return name end
  return 'Track'
end

local function track_guid(track)
  local g = reaper.GetTrackGUID(track)
  if type(g) ~= 'string' then return '' end
  return g
end

local function is_track_valid(track)
  return track and reaper.ValidatePtr2 and reaper.ValidatePtr2(0, track, 'MediaTrack*')
end

local function is_fx_index_valid(track, fx)
  if not is_track_valid(track) then return false end
  local cnt = reaper.TrackFX_GetCount(track)
  return type(cnt) == 'number' and fx >= 0 and fx < cnt
end

local function fx_key(track, fx)
  return track_guid(track) .. ':' .. tostring(fx)
end

local function get_fx_display_name(track, fx)
  local ok, name = reaper.TrackFX_GetFXName(track, fx, '')
  if not ok then return 'FX' end
  return registry.normalize_fx_name(name)
end

local function get_open_sig(track, fx)
  local floating = reaper.TrackFX_GetFloatingWindow and reaper.TrackFX_GetFloatingWindow(track, fx)
  if floating then
    return 'F', floating
  end
  local open = reaper.TrackFX_GetOpen and reaper.TrackFX_GetOpen(track, fx)
  if open then
    return 'R', nil
  end
  return nil, nil
end

local function close_native_floating(track, fx, hwnd)
  -- TrackFX_Show: 0=hide, 1=show chain, 2=show floating
  if reaper.TrackFX_Show then
    pcall(reaper.TrackFX_Show, track, fx, 0)
  end

  -- Extra safety: on some systems TrackFX_Show(0) may fail to immediately hide a
  -- JSFX floating window. If the user has js_ReaScriptAPI, hide the native HWND.
  if hwnd and reaper.JS_Window_Show and reaper.JS_Window_IsWindow then
    local ok, is_win = pcall(reaper.JS_Window_IsWindow, hwnd)
    if ok and is_win then
      pcall(reaper.JS_Window_Show, hwnd, 'HIDE')
    end
  end
end

local function get_ui_scale()
  local s = tonumber(ext_get('FxPanelScale') or '')
  if not s or s < 0.5 or s > 3.0 then
    return DEFAULT_SCALE
  end
  return s
end

local function set_ui_scale(v)
  v = tonumber(v) or DEFAULT_SCALE
  if v < 0.5 then v = 0.5 end
  if v > 3.0 then v = 3.0 end
  ext_set('FxPanelScale', string.format('%.3f', v), true)
end

local function collect_preset_params(track, fx)
  local out = {}
  local n = reaper.TrackFX_GetNumParams(track, fx) or 0
  for i = 0, n - 1 do
    local ok, pname = reaper.TrackFX_GetParamName(track, fx, i, '')
    pname = (ok and pname) or ''
    local l = tostring(pname):lower()
    -- Filter obvious meters/telemetry
    if not (l:find('spec', 1, true) or l:find('meter', 1, true) or l:find('peak', 1, true) or l:find('gr', 1, true) or l:find('tele', 1, true)) then
      -- Web UI schema uses {index,value}. Keep it compatible.
      out[#out + 1] = { index = i, value = params.get_norm(track, fx, i) }
    end
  end
  return out
end

local function apply_preset_params(track, fx, preset)
  if type(preset) ~= 'table' then return end
  local list = preset.params
  if type(list) ~= 'table' then return end
  for _, p in ipairs(list) do
    local idx = tonumber(p.index or p.idx)
    local v = tonumber(p.value)
    if idx and v then
      params.set_norm(track, fx, idx, v)
    end
  end
end

local function begin_table_stretch(ctx, id, cols)
  if not reaper.ImGui_BeginTable then return false end
  local flags = 0
  local sizing = compat.resolve_enum(reaper.ImGui_TableFlags_SizingStretchProp)
    or compat.resolve_enum(reaper.ImGui_TableFlags_SizingStretchSame)
    or compat.resolve_enum(reaper.ImGui_TableFlags_SizingFixedFit)
  -- If we can't resolve a sizing policy enum, don't use tables at all. On ReaImGui
  -- 0.10.x passing column widths without an explicit sizing policy can assert.
  if not sizing then return false end
  flags = compat.bor(flags, sizing)
  return reaper.ImGui_BeginTable(ctx, id, cols, flags)
end

local function _right_align_from_window(ctx, right_w)
  -- Safe right alignment without SetCursorPos (ReaImGui 0.10.x friendly).
  if not (reaper.ImGui_GetContentRegionAvail and reaper.ImGui_Dummy and reaper.ImGui_SameLine) then return end
  local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx))
  if type(avail_w) ~= 'number' then return end
  local pad = avail_w - (right_w or 0)
  if pad > 1 then
    reaper.ImGui_Dummy(ctx, pad, 0)
    reaper.ImGui_SameLine(ctx, 0, 0)
  end
end

local function header_row(ctx, ws, scale)
  local c = theme.colors()
  local m = theme.metrics(scale)
  local track = ws.track
  local fx = ws.fx
  local track_name = ws.track_name or 'Track'
  local fx_name = ws.fx_name or 'FX'

  local enabled = true
  if reaper.TrackFX_GetEnabled then
    enabled = reaper.TrackFX_GetEnabled(track, fx)
  end

  local btn_h = m.control_h
  local gap = m.toolbar_gap
  local w_insp = 92 * scale
  local w_on = 52 * scale
  local w_x = 32 * scale

  -- Header background
  if reaper.ImGui_GetWindowDrawList and reaper.ImGui_DrawList_AddRectFilled then
    local dl = reaper.ImGui_GetWindowDrawList(ctx)
    local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
    local avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx)) or 0
    local h = m.topbar_h * 0.75
    local col = reaper.ImGui_ColorConvertDouble4ToU32 and reaper.ImGui_ColorConvertDouble4ToU32(theme.rgba(c.panel_alt)) or nil
    if dl and col and avail_w > 1 then
      pcall(reaper.ImGui_DrawList_AddRectFilled, dl, x, y, x + avail_w, y + h, col, 10 * scale)
    end
  end

  -- Header content (single line): title on the left, buttons pinned to the right.
  local right_w = w_insp + gap + w_on + gap + w_x
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_FramePadding), m.control_pad_x, (btn_h - m.control_font) * 0.5)

  reaper.ImGui_AlignTextToFramePadding(ctx)
  ui.push_color(ctx, reaper.ImGui_Col_Text, theme.rgba(c.text))
  reaper.ImGui_Text(ctx, tostring(track_name) .. ' • ' .. tostring(fx_name))
  pcall(reaper.ImGui_PopStyleColor, ctx)

  -- Buttons
  reaper.ImGui_SameLine(ctx, 0, 0)
  _right_align_from_window(ctx, right_w)

  if ws.show_inspector then
    ui.push_color(ctx, reaper.ImGui_Col_Button, theme.rgba(c.slot))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, theme.rgba(c.panel))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, theme.rgba(c.panel_alt))
  else
    ui.push_color(ctx, reaper.ImGui_Col_Button, theme.rgba(c.panel))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, theme.rgba(c.slot))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, theme.rgba(c.panel_alt))
  end
  if reaper.ImGui_Button(ctx, 'Inspector##' .. ws.id, w_insp, btn_h) then
    ws.show_inspector = not ws.show_inspector
  end
  pcall(reaper.ImGui_PopStyleColor, ctx, 3)
  reaper.ImGui_SameLine(ctx, 0, gap)

  local on_label = enabled and 'ON' or 'OFF'
  if enabled then
    ui.push_color(ctx, reaper.ImGui_Col_Button, theme.rgba(c.accent))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, theme.rgba(c.accent, 0.88))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, theme.rgba(c.accent, 0.75))
  else
    ui.push_color(ctx, reaper.ImGui_Col_Button, theme.rgba(c.panel))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, theme.rgba(c.slot))
    ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, theme.rgba(c.panel_alt))
  end
  if reaper.ImGui_Button(ctx, on_label .. '##' .. ws.id, w_on, btn_h) then
    if reaper.TrackFX_SetEnabled then
      reaper.TrackFX_SetEnabled(track, fx, not enabled)
    end
  end
  pcall(reaper.ImGui_PopStyleColor, ctx, 3)

  reaper.ImGui_SameLine(ctx, 0, gap)

  -- Close button: neutral grey like Web UI (not red).
  ui.push_color(ctx, reaper.ImGui_Col_Button, theme.rgba(c.panel))
  ui.push_color(ctx, reaper.ImGui_Col_ButtonHovered, theme.rgba(c.slot))
  ui.push_color(ctx, reaper.ImGui_Col_ButtonActive, theme.rgba(c.panel_alt))
  ui.push_color(ctx, reaper.ImGui_Col_Text, theme.rgba(c.text))
  if reaper.ImGui_Button(ctx, 'X##' .. ws.id, w_x, btn_h) then
    ws.request_close = true
  end
  pcall(reaper.ImGui_PopStyleColor, ctx, 4)

  pcall(reaper.ImGui_PopStyleVar, ctx)

  reaper.ImGui_Dummy(ctx, 0, 6 * scale)
end


local function presets_row(ctx, ws, scale)
  local list = ws.presets or {}
  local btn_h = 24 * scale
  local gap = 6 * scale
  local w_save = 64 * scale
  local w_del = 74 * scale
  local right_w = w_save + gap + w_del

  -- Compute dropdown width so Save/Delete stick to the right like in Web UI.
  local avail_w = 0
  if reaper.ImGui_GetContentRegionAvail then
    avail_w = select(1, reaper.ImGui_GetContentRegionAvail(ctx)) or 0
  end
  local combo_w = math.max(160 * scale, avail_w - right_w - gap)

  -- Dropdown (left)
  reaper.ImGui_PushStyleVar(ctx, E(reaper.ImGui_StyleVar_FramePadding), 10 * scale, 5 * scale)
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
    -- Ultra-old fallback: just show text
    reaper.ImGui_Text(ctx, preview)
  end

  if reaper.ImGui_PopItemWidth then reaper.ImGui_PopItemWidth(ctx) end
  reaper.ImGui_PopStyleVar(ctx)

  -- Save/Delete (right)
  reaper.ImGui_SameLine(ctx, 0, 0)
  _right_align_from_window(ctx, right_w)
  if reaper.ImGui_Button(ctx, 'Save##' .. ws.id, w_save, btn_h) then ws.request_save_preset = true end
  reaper.ImGui_SameLine(ctx, 0, gap)
  if reaper.ImGui_Button(ctx, 'Delete##' .. ws.id, w_del, btn_h) then ws.request_delete_preset = true end

  reaper.ImGui_Separator(ctx)
end
local function render_inspector(ctx, ws, scale)
  local track, fx = ws.track, ws.fx
  local n = reaper.TrackFX_GetNumParams(track, fx) or 0

  -- IMPORTANT: avoid BeginChild/EndChild here.
  -- Some ReaImGui builds (esp. 0.10.x on macOS) can report "Must call EndChild() and not End()"
  -- when toggling Inspector due to child stack mismatches. Rendering inline is safer.
  for i = 0, n - 1 do
    local ok, pname = reaper.TrackFX_GetParamName(track, fx, i, '')
    pname = (ok and pname) or ('Param ' .. i)
    local v = params.get_norm(track, fx, i)
    local fmt = params.get_formatted(track, fx, i)

    reaper.ImGui_PushID(ctx, i)

    reaper.ImGui_Text(ctx, pname)
    reaper.ImGui_SameLine(ctx)
    reaper.ImGui_TextDisabled(ctx, fmt)

    reaper.ImGui_SetNextItemWidth(ctx, -1)
    local changed, newv = reaper.ImGui_SliderDouble(ctx, '##v', v, 0.0, 1.0, '')
    if changed then
      params.set_norm(track, fx, i, newv)
    end

    reaper.ImGui_Separator(ctx)
    reaper.ImGui_PopID(ctx)
  end

end

local function render_panel(ctx, ws, scale)
  local panel = ws.panel
  if panel and panel.render then
    panel.render(ctx, ws.track, ws.fx, ui, { scale = scale, ui_scale = scale })
    return
  end
  render_inspector(ctx, ws, scale)
end

local function render_window(ctx, ws)
  if not is_fx_index_valid(ws.track, ws.fx) then
    ws.request_close = true
    return
  end

  local scale = get_ui_scale()

  if reaper.ImGui_SetNextWindowSizeConstraints then
    pcall(reaper.ImGui_SetNextWindowSizeConstraints, ctx, 420 * scale, 280 * scale, 4096 * scale, 4096 * scale)
  end

  local win_flags = 0
  win_flags = compat.bor(win_flags, compat.resolve_enum(reaper.ImGui_WindowFlags_NoCollapse) or 0)
  win_flags = compat.bor(win_flags, compat.resolve_enum(reaper.ImGui_WindowFlags_NoTitleBar) or 0)
  win_flags = compat.bor(win_flags, compat.resolve_enum(reaper.ImGui_WindowFlags_NoDocking) or 0)

  -- Size
  if not ws._size_inited then
    ws._size_inited = true
    local mw = 640
    local mh = 420
    if ws.panel and ws.panel.meta then
      mw = ws.panel.meta.win_w or mw
      mh = ws.panel.meta.win_h or mh
    end
    local cond = E(reaper.ImGui_Cond_Appearing) or E(reaper.ImGui_Cond_FirstUseEver)
    pcall(reaper.ImGui_SetNextWindowSize, ctx, mw * scale, mh * scale, cond)
    if reaper.ImGui_SetNextWindowSizeConstraints then
      pcall(reaper.ImGui_SetNextWindowSizeConstraints, ctx, 420 * scale, 280 * scale, 4096 * scale, 4096 * scale)
    end
  end

  local sv, sc = push_theme(ctx, scale)

  -- IMPORTANT: Always guarantee End() even if panel code throws.
  -- If Begin() fails (can return nil on macOS for an invalid frame), do not call End().
  local began_ok, shown, open = pcall(reaper.ImGui_Begin, ctx, '##ReaperRMFX_' .. ws.id, true, win_flags)
  local began = began_ok and (shown ~= nil)
  if began then
    local frame_had_err = false
    local body_ok, body_err = xpcall(function()
      if shown then
        if ws.panel and ws.panel.render_header then
          ws.panel.render_header(ctx, ws, scale, ui)
        else
          header_row(ctx, ws, scale)
        end

        -- Always show last error *before* calling presets/panel.
        -- Otherwise a recurring failure inside presets_row() makes the window
        -- look permanently empty with no visible error.
        if ws.last_error and ws.last_error ~= '' then
          pcall(function()
            if ui and ui.push_color then
              ui.push_color(ctx, reaper.ImGui_Col_Text, 1.0, 0.35, 0.35, 1.0)
            end
            local msg = tostring(ws.last_error)
            if reaper.ImGui_TextWrapped then
              reaper.ImGui_TextWrapped(ctx, msg)
            else
              reaper.ImGui_Text(ctx, msg)
            end
            pcall(reaper.ImGui_PopStyleColor, ctx, 1)
            reaper.ImGui_Separator(ctx)
          end)
        end

        -- Presets row (protected) - keep rendering even if presets UI breaks.
        local ok_p, err_p = xpcall(function()
          if ws.panel and ws.panel.render_presets_row then
            ws.panel.render_presets_row(ctx, ws, scale, ui)
          else
            presets_row(ctx, ws, scale)
          end
        end, debug.traceback)
        if not ok_p then
          ws.last_error = tostring(err_p)
          frame_had_err = true
        end

        -- Panel/Inspector (protected)
        local ok_body, err_body = xpcall(function()
          if ws.show_inspector then
            render_inspector(ctx, ws, scale)
          else
            render_panel(ctx, ws, scale)
          end
        end, debug.traceback)
        if not ok_body then
          ws.last_error = tostring(err_body)
          frame_had_err = true
        end
      end
    end, debug.traceback)

    pcall(reaper.ImGui_End, ctx)
    pop_theme(ctx, sv, sc)

    if not body_ok then
      ws.last_error = tostring(body_err)
      frame_had_err = true
      -- Keep running; the error will be shown next frame.
    end
    -- Clear stale error only if nothing failed this frame.
    if not frame_had_err then
      ws.last_error = nil
    end

    if open == false then
      ws.request_close = true
    end
  else
    -- Begin failed; avoid touching ImGui further this frame.
    pop_theme(ctx, sv, sc)
    ws.last_error = ws.last_error or 'ImGui_Begin failed (context may be invalid)'
    ws.request_close = true
  end

  if ws.request_close then
    ws.request_close = true
  end
end

function main.run()
  local state = {
    ctx = create_ctx(),
    windows = {},
    dismissed = {},
    last_open_sig = {},
  }

  local function loop()
    if should_stop() then
      if state.ctx then pcall(reaper.ImGui_DestroyContext, state.ctx) end
      return
    end

    -- Hard guard: context can become invalid on macOS. If it happens, recreate.
    if not ensure_ctx(state) then
      reaper.defer(loop)
      return
    end
    hb_write('FxPanelsHB')

    if not panels_enabled() then
      -- When disabled, close all FX windows and reset open-state tracking.
      for k, _ in pairs(state.windows) do
        state.windows[k] = nil
      end
      for k, _ in pairs(state.last_open_sig) do
        state.last_open_sig[k] = nil
      end
      for k, _ in pairs(state.dismissed) do
        state.dismissed[k] = nil
      end
      reaper.defer(loop)
      return
    end

    local open_map = {}
    local function consider_track(track)
      if not is_track_valid(track) then return end
      local fx_count = reaper.TrackFX_GetCount(track) or 0
      for fx = 0, fx_count - 1 do
        local fx_name = get_fx_display_name(track, fx)
        if registry.is_supported_fx(fx_name) then
          local sig = nil
          local hwnd
          sig, hwnd = get_open_sig(track, fx)
          if sig ~= nil then
            local k = fx_key(track, fx)
            open_map[k] = { track = track, fx = fx, fx_name = fx_name, track_name = get_track_name(track), sig = sig, hwnd = hwnd }
          end
        end
      end
    end

    consider_track(reaper.GetMasterTrack(0))
    local track_count = reaper.CountTracks(0)
    for i = 0, track_count - 1 do
      consider_track(reaper.GetTrack(0, i))
    end

    -- Create windows on open events.
    for k, info in pairs(open_map) do
      local prev = state.last_open_sig[k]
      state.last_open_sig[k] = info.sig
      local open_event = (prev == nil and info.sig ~= nil) or (prev ~= info.sig)

      local ws = state.windows[k]
      if ws == nil and open_event then
        local panel_key = registry.match_panel_key(info.fx_name)
        local panel = panel_key and registry.get_panel(panel_key) or nil
        ws = {
          id = k,
          track = info.track,
          fx = info.fx,
          fx_name = info.fx_name,
          track_name = info.track_name,
          sig = info.sig,
          pinned = (info.sig == 'F'),
          panel = panel,
          show_inspector = false,
          _preset_cache = nil,
          _preset_sel = 0,
        }
        state.windows[k] = ws
        state.dismissed[k] = nil
      elseif ws ~= nil then
        ws.track = info.track
        ws.fx = info.fx
        ws.fx_name = info.fx_name
        ws.track_name = info.track_name
        ws.sig = info.sig
        if info.sig == 'F' then ws.pinned = true end
      end

      -- For floating windows, close native and keep ImGui pinned.
      if info.sig == 'F' then
        close_native_floating(info.track, info.fx, info.hwnd)
      end
    end

    -- Update last_open_sig for keys not currently open.
    for k, prev in pairs(state.last_open_sig) do
      if open_map[k] == nil then
        state.last_open_sig[k] = nil
      end
    end

    -- Close windows whose rack view was closed; keep pinned floating replacements.
    for k, ws in pairs(state.windows) do
      local info = open_map[k]
      if not is_fx_index_valid(ws.track, ws.fx) then
        ws.request_close = true
      elseif info == nil then
        if not ws.pinned then
          ws.request_close = true
        end
      else
        -- Rack windows are not pinned
        if info.sig == 'R' then
          ws.pinned = false
        end
      end
    end

    -- Render
    for k, ws in pairs(state.windows) do
      render_window(state.ctx, ws)
      if ws.request_close then
        state.windows[k] = nil
        state.dismissed[k] = true
      end
    end

    reaper.defer(loop)
  end

  math.randomseed(os.time())
  reaper.defer(loop)
end

return main
