-- ReaperRM RemoteMixerControl.lua
-- Single entry point: starts server daemon + bridge + FX ReaImGui panels.
-- macOS 26.2 + ReaImGui 0.10.0.2 hardened (stack-safe, ctx-safe).

local SCRIPT_NAME = 'RemoteMixerControl'
local EXT_SECTION = 'ReaperRM'


-- forward decls for helpers used early
local join_path
local get_script_dir
local HB_STALE_SECONDS = 2.0
local POLL_INTERVAL = 1.0
local LOG_POLL_INTERVAL = 2.0

local ctx_name = 'ReaperRM Control'
local ctx = nil

local state = {
  ui_visible = true,
  show_diag = false,
  show_scenes = false,
  autostart_done = false,
  last_poll = 0,
  last_log_poll = 0,
  status = { running = false },
  logs = {},
  error = '',
  fxpanels_started = false,
}

-- ---------- helpers ----------
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



-- ---------- Scenes (ReaImGui) ----------
-- Stored per-project in ProjExtState: section EXT_SECTION, key ScenesV1
local json = nil
local function ensure_json()
  if json ~= nil then return json end
  local ok, mod = pcall(dofile, join_path(get_script_dir(), 'lua/fxpanels/json.lua'))
  if ok and type(mod) == 'table' then json = mod else json = false end
  return json
end

local function proj_get(key)
  local rv, val = reaper.GetProjExtState(0, EXT_SECTION, key)
  if rv == 1 then return val end
  return ''
end

local function proj_set(key, value)
  reaper.SetProjExtState(0, EXT_SECTION, key, tostring(value or ''))
end

local function scenes_default()
  return {
    current = 'main',
    scenes = {
      { name = 'main', all = true,  guids = {}, masterGuid = 'MASTER' },
      { name = 'mon1', all = false, guids = {}, masterGuid = '' },
      { name = 'mon2', all = false, guids = {}, masterGuid = '' },
    }
  }
end

local function scenes_load()
  local j = ensure_json()
  if not j then return scenes_default() end
  local raw = proj_get('ScenesV1')
  if raw == '' then return scenes_default() end
  local ok, obj = pcall(j.decode, raw)
  if not ok or type(obj) ~= 'table' then return scenes_default() end
  if type(obj.scenes) ~= 'table' then obj.scenes = scenes_default().scenes end
  if type(obj.current) ~= 'string' or obj.current == '' then obj.current = 'main' end
  for _, sc in ipairs(obj.scenes) do
    if type(sc.name) ~= 'string' or sc.name == '' then sc.name = 'scene' end
    sc.all = (sc.name == 'main') and true or (sc.all and true or false)
    if type(sc.guids) ~= 'table' then sc.guids = {} end
    -- single-master model (backward compatible with old masterGuids)
    if type(sc.masterGuid) ~= 'string' then sc.masterGuid = '' end
    if sc.name == 'main' then
      sc.masterGuid = 'MASTER'
    else
      -- legacy: take first masterGuids entry if present
      if sc.masterGuid == '' and type(sc.masterGuids) == 'table' and type(sc.masterGuids[1]) == 'string' then
        sc.masterGuid = sc.masterGuids[1]
      end
      if sc.masterGuid == 'MASTER' then sc.masterGuid = '' end
    end
    sc.masterGuids = nil
  end
  return obj
end

local function scenes_save(data)
  local j = ensure_json()
  if not j then return end
  local ok, raw = pcall(j.encode, data)
  if ok and type(raw) == 'string' then proj_set('ScenesV1', raw) end
end

local function scenes_current(data)
  if not data or type(data.scenes) ~= 'table' then return nil end
  local cur = data.current or 'main'
  for _, sc in ipairs(data.scenes) do
    if sc.name == cur then return sc end
  end
  data.current = 'main'
  for _, sc in ipairs(data.scenes) do
    if sc.name == 'main' then return sc end
  end
  return data.scenes[1]
end

local function get_tracks_flat()
  local out = { { guid = 'MASTER', idx = 0, name = 'MASTER' } }
  local cnt = reaper.CountTracks(0)
  for i = 0, cnt - 1 do
    local tr = reaper.GetTrack(0, i)
    if tr then
      local _, name = reaper.GetTrackName(tr, '')
      local guid = reaper.GetTrackGUID(tr)
      out[#out+1] = { guid = guid, idx = i + 1, name = name or ('Track ' .. tostring(i+1)) }
    end
  end
  return out
end

local function scene_has(scene, guid)
  if not scene or type(scene.guids) ~= 'table' then return false end
  for _, g in ipairs(scene.guids) do if g == guid then return true end end
  return false
end

local function scene_set(scene, guid, on)
  if not scene or type(scene.guids) ~= 'table' then return end
  local has = scene_has(scene, guid)
  if on and not has then
    scene.guids[#scene.guids+1] = guid
  elseif (not on) and has then
    local next = {}
    for _, g in ipairs(scene.guids) do if g ~= guid then next[#next+1] = g end end
    scene.guids = next
  end
end


local function master_has(scene, guid)
  return scene and type(scene.masterGuid) == 'string' and scene.masterGuid ~= '' and scene.masterGuid == guid
end

local function master_set(scene, guid, on)
  if not scene then return end
  if scene.name == 'main' then
    scene.masterGuid = 'MASTER'
    return
  end
  if on then
    scene.masterGuid = (type(guid) == 'string') and guid or ''
  else
    if scene.masterGuid == guid then scene.masterGuid = '' end
  end
end

local function draw_scenes_manager()
  if not state.scenes_data then state.scenes_data = scenes_load() end
  local data = state.scenes_data
  local cur = scenes_current(data)

  local card_open, card_child, card_scope = ui.card_begin(ctx, 'sc_card', 1.0, 0, 0)
  if card_open then
    ui.section_title(ctx, 'Scenes manager (project)')
    local toolbar_scope = ui.toolbar_begin(ctx, 1.0)
    reaper.ImGui_SameLine(ctx, 0, 8)
    if ui.button_secondary(ctx, 'Save##sc', 1.0) then scenes_save(data) end
    reaper.ImGui_SameLine(ctx, 0, 8)
    if ui.button_secondary(ctx, 'Reload##sc', 1.0) then state.scenes_data = scenes_load(); data = state.scenes_data; cur = scenes_current(data) end
    ui.toolbar_end(ctx, toolbar_scope)

    reaper.ImGui_Separator(ctx)
  end

  -- Scene selector
  local cur_name = cur and cur.name or 'main'
  if reaper.ImGui_BeginCombo(ctx, 'Scene##sc', cur_name) then
    for _, sc in ipairs(data.scenes) do
      local sel = (sc.name == cur_name)
      if reaper.ImGui_Selectable(ctx, sc.name, sel) then
        data.current = sc.name
        cur = scenes_current(data)
        scenes_save(data)
      end
      if sel then reaper.ImGui_SetItemDefaultFocus(ctx) end
    end
    reaper.ImGui_EndCombo(ctx)
  end

  reaper.ImGui_SameLine(ctx)
  if ui.button_secondary(ctx, 'Add##sc', 1.0) then
    local ok, name = reaper.GetUserInputs('New scene', 1, 'Scene name', '')
    if ok and name and name:gsub('%s+', '') ~= '' then
      local clean = name:gsub('^%s+', ''):gsub('%s+$', '')
      local exists = false
      for _, sc in ipairs(data.scenes) do if sc.name:lower() == clean:lower() then exists = true break end end
      if not exists then
        data.scenes[#data.scenes+1] = { name = clean, all = false, guids = {}, masterGuid = 'MASTER' }
        data.current = clean
        cur = scenes_current(data)
        scenes_save(data)
      end
    end
  end

  reaper.ImGui_SameLine(ctx)
  if ui.button_secondary(ctx, 'Delete##sc', 1.0) then
    if cur and cur.name ~= 'main' then
      data.scenes = (function()
        local next = {}
        for _, sc in ipairs(data.scenes) do if sc.name ~= cur.name then next[#next+1] = sc end end
        return next
      end)()
      data.current = 'main'
      scenes_save(data)
      cur = scenes_current(data)
    end
  end

  if not cur then
    ui.card_end(ctx, card_child, card_scope)
    return
  end

  -- Master track for scene
  local tracks = get_tracks_flat()
  local master_guid = (type(cur.masterGuid) == 'string') and cur.masterGuid or ''
  if cur.name == 'main' then
    master_guid = 'MASTER'
    cur.masterGuid = 'MASTER'
  end

  local function label_for_guid(g)
    if g == '' or g == nil then return '(no master)' end
    if g == 'MASTER' then return 'MASTER' end
    for _, t in ipairs(tracks) do
      if t.guid == g then
        return string.format('%d: %s', t.idx or t.i or 0, t.name or g)
      end
    end
    return g
  end

  local tn_flags = 0
  if reaper.ImGui_TreeNodeFlags_DefaultOpen then tn_flags = reaper.ImGui_TreeNodeFlags_DefaultOpen() end

  if reaper.ImGui_CollapsingHeader(ctx, 'Master##sc', tn_flags) then
    if cur.name == 'main' then
      reaper.ImGui_Text(ctx, 'Main scene master is fixed: MASTER')
    else
      local master_label = label_for_guid(master_guid)
      if reaper.ImGui_BeginCombo(ctx, 'Master track##sc', master_label) then
        local sel_none = (master_guid == '')
        if reaper.ImGui_Selectable(ctx, '(no master)##scm_none', sel_none) then
          cur.masterGuid = ''
          scenes_save(data)
        end
        if sel_none then reaper.ImGui_SetItemDefaultFocus(ctx) end

        for _, t in ipairs(tracks) do
          if t.guid ~= 'MASTER' then
            local sel = (master_guid == t.guid)
            if reaper.ImGui_Selectable(ctx, string.format('%d: %s##scm_%s', t.idx or t.i or 0, t.name or t.guid, t.guid), sel) then
              cur.masterGuid = t.guid
              scenes_save(data)
            end
            if sel then reaper.ImGui_SetItemDefaultFocus(ctx) end
          end
        end
        reaper.ImGui_EndCombo(ctx)
      end
      reaper.ImGui_TextWrapped(ctx, 'Tip: if master is a folder track, Web UI will show its children too.')
    end
  end

-- Track selection
  local tn_flags2 = 0
  if reaper.ImGui_TreeNodeFlags_DefaultOpen then tn_flags2 = reaper.ImGui_TreeNodeFlags_DefaultOpen() end
  if reaper.ImGui_CollapsingHeader(ctx, 'Tracks in scene##sc', tn_flags2) then
    state.scenes_search = state.scenes_search or ''
    local changed, q = ui.input_text_web(ctx, 'Search##sc', state.scenes_search, 1.0, 260)
    if changed then state.scenes_search = q end

    -- ReaImGui's BeginChild expects numeric flags (Dear ImGui's old 'border' bool is not supported).
    local child_flags = 0
    if reaper.ImGui_ChildFlags_Border then child_flags = reaper.ImGui_ChildFlags_Border() end
    if reaper.ImGui_BeginChild(ctx, 'sc_list', 0, 240, child_flags) then
      local needle = (state.scenes_search or ''):lower()
      for _, t in ipairs(tracks) do
        if t.guid ~= 'MASTER' then
          local name_l = (t.name or ''):lower()
          if needle == '' or name_l:find(needle, 1, true) then
            local on = scene_has(cur, t.guid)
            local is_master = (cur.name ~= 'main' and type(cur.masterGuid) == 'string' and cur.masterGuid ~= '' and cur.masterGuid == t.guid)
            local toggled, v = reaper.ImGui_Checkbox(ctx, string.format('%d: %s##sc_t_%s', t.idx or t.i or 0, t.name or t.guid, t.guid), on)
            reaper.ImGui_SameLine(ctx, 0, 6)
            local mlabel = is_master and 'M*' or 'M'
            if ui.button_ghost(ctx, mlabel .. '##sc_m_' .. t.guid, 1.0) then
              if cur.name ~= 'main' then
                if is_master then cur.masterGuid = '' else cur.masterGuid = t.guid end
                scenes_save(data)
              end
            end
            if toggled then
              scene_set(cur, t.guid, v)
              scenes_save(data)
            end
          end
        end
      end
      reaper.ImGui_EndChild(ctx)
    end
  end
  ui.card_end(ctx, card_child, card_scope)
end
local function hb_write(key)
  ext_set(key, string.format('%.6f', now()), false)
end

local function hb_alive(hb)
  local t = tonumber(hb or '')
  if not t then return false end
  return (now() - t) <= HB_STALE_SECONDS
end

get_script_dir = function()
  local info = debug.getinfo(1, 'S')
  local src = info and info.source or ''
  src = src:gsub('^@', '')
  return src:match('^(.*)/') or reaper.GetResourcePath()
end

join_path = function(a, b)
  if not a or a == '' then return b end
  if a:sub(-1) == '/' then return a .. b end
  return a .. '/' .. b
end

local SCRIPT_DIR = get_script_dir()
do
  local base = join_path(SCRIPT_DIR, 'lua')
  package.path = base .. '/?.lua;' .. base .. '/?/init.lua;' .. package.path
end

local ui = require('fxpanels.ui')
local theme = require('fxpanels.theme')

local function get_script_path(name)
  return join_path(SCRIPT_DIR, name)
end

local function run_action_script(path)
  local add_script = reaper.AddRemoveReaScript
  local main_cmd = reaper.Main_OnCommand
  if not add_script or not main_cmd then
    return false
  end
  local cmd_id = add_script(1, 0, path, true)
  if type(cmd_id) == 'table' then
    cmd_id = cmd_id[1]
  end
  cmd_id = tonumber(cmd_id) or 0
  if cmd_id <= 0 then
    return false
  end
  main_cmd(cmd_id, 0)
  return true
end

-- ---------- daemon control (launcher) ----------
local function exec_process(cmd, timeout)
  if not reaper.ExecProcess then
    return false, 'ExecProcess not available'
  end
  local out = reaper.ExecProcess(cmd, timeout or 5000)
  return true, out
end

local function file_exists(path)
  if not path or path == '' then return false end
  local f = io.open(path, 'r')
  if f then
    f:close()
    return true
  end
  return false
end

local function find_python_fallback()
  local ok, out = exec_process('/usr/bin/which python3', 1000)
  if ok and out then
    local path = tostring(out):match('(%S+)')
    if file_exists(path) then return path end
  end
  local ok2, out2 = exec_process('/usr/bin/which python', 1000)
  if ok2 and out2 then
    local path = tostring(out2):match('(%S+)')
    if file_exists(path) then return path end
  end
  local candidates = {
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  }
  for _, path in ipairs(candidates) do
    if file_exists(path) then return path end
  end
  return nil
end

local function resolve_python()
  local py = ext_get('PythonPathConsole')
  if py == nil or py == '' then py = ext_get('PythonPath') end
  if py ~= nil and py ~= '' and py:lower():find('reaper') then
    py = ''
  end
  if py == nil or py == '' then
    local os_name = reaper.GetOS and reaper.GetOS() or ''
    if not os_name:find('Win') then
      py = find_python_fallback() or 'python3'
    else
      py = 'python'
    end
  end
  if py:lower():find('reaper') then
    py = 'python3'
  end
  if py:lower():find('pythonw.exe') then
    local candidate = py:gsub('pythonw%.exe$', 'python.exe')
    if candidate ~= py then
      py = candidate
    end
  end
  ext_set('PythonPathConsole', py, true)
  return py
end

local function quote_arg(value)
  value = tostring(value or '')
  if value == '' then return '""' end
  if value:find('[%s"]') then
    value = value:gsub('"', '\\"')
    return '"' .. value .. '"'
  end
  return value
end

local function launcher_cmd(args)
  local launcher = get_script_path('RemoteMixerLauncher.py')
  local py = resolve_python()
  return string.format('%s %s %s', quote_arg(py), quote_arg(launcher), args or '')
end

local function parse_json(text)
  local function extract_json(payload)
    payload = tostring(payload or '')
    local start_pos = payload:find('{', 1, true)
    if start_pos then
      local end_idx = payload:match('.*()}')
      if end_idx and end_idx >= start_pos then
        return payload:sub(start_pos, end_idx)
      end
    end
    return payload
  end
  local ok, json = pcall(function()
    local base = join_path(SCRIPT_DIR, 'lua')
    package.path = base .. '/?.lua;' .. base .. '/?/init.lua;' .. package.path
    local j = require('fxpanels.json')
    return j.decode(extract_json(text))
  end)
  if ok then return json end
  return nil
end

local function poll_status()
  local cmd = launcher_cmd('status')
  local ok, out = exec_process(cmd, 2000)
  if not ok then
    state.status = { running = false }
    return
  end
  local j = parse_json(out or '')
  if type(j) == 'table' then
    state.status = j
    state.error = ''
  else
    state.status = { running = false }
    if tostring(out or ''):match('%-999') then
      state.error = 'Status error: -999 (failed to run: ' .. cmd .. ')'
    elseif out and out ~= '' then
      state.error = 'Status error: ' .. tostring(out)
    else
      state.error = 'Status error: no output (check Python path)'
    end
  end
end

local function poll_logs()
  local ok, out = exec_process(launcher_cmd('logs --tail 200'), 2000)
  if not ok or not out then
    state.logs = { '(no logs)' }
    return
  end
  local lines = {}
  for s in tostring(out):gmatch('[^\r\n]+') do
    lines[#lines + 1] = s
  end
  state.logs = lines
end

local function send_control(verb)
  exec_process(launcher_cmd(verb), 5000)
end

local function spawn_daemon()
  local ok, out = exec_process(launcher_cmd('start'), 8000)
  if not ok then
    return false, out
  end
  return true
end

local function get_lan_ip()
  -- best-effort local IP for display (unchanged from original)
  local py = resolve_python()
  local cmd = string.format(
    "%s -c \"import socket\nimport sys\ntry:\n s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)\n s.connect(('8.8.8.8',80))\n print(s.getsockname()[0])\nexcept Exception:\n print('127.0.0.1')\n\"",
    quote_arg(py)
  )
  local ok, out = exec_process(cmd, 1500)
  if ok and out then
    local ip = tostring(out):match('(%d+%.%d+%.%d+%.%d+)')
    if ip then return ip end
  end
  return '127.0.0.1'
end

local function url_for(st)
  st = st or {}
  if st.url and st.url ~= '' then
    return st.url
  end
  if st.urls and type(st.urls) == 'table' and st.urls[1] then
    return st.urls[1]
  end
  local scheme = st.https and 'https' or 'http'
  local ip = get_lan_ip()
  local port = tonumber(st.web_port or st.port or 3000) or 3000
  return string.format('%s://%s:%d', scheme, ip, port)
end

-- ---------- bridge ----------
local function is_bridge_alive()
  return hb_alive(ext_get('BridgeHB'))
end

local function start_bridge()
  ext_set('BridgeStop', '0', false)
  if not is_bridge_alive() then
    run_action_script(get_script_path('RemoteMixer.py'))
  end
end

local function stop_bridge()
  ext_set('BridgeStop', '1', false)
end

-- ---------- fx panels ----------
local function ensure_fxpanels_started()
  if state.fxpanels_started then return end

  -- Force stop any legacy external fxpanels script.
  ext_set('FxPanelsStop', '0', false)
  ext_set('FxReplaceEnabled', ext_get('FxReplaceEnabled') ~= '0' and '1' or '0', true)

  -- Setup package path for this script run.
  local base = join_path(SCRIPT_DIR, 'lua')
  package.path = base .. '/?.lua;' .. base .. '/?/init.lua;' .. package.path

  local ok, mod = pcall(require, 'fxpanels.main')
  if ok and type(mod) == 'table' and type(mod.run) == 'function' then
    mod.run()
    state.fxpanels_started = true
  else
    state.error = 'Failed to load fxpanels.main'
  end
end

-- ---------- single instance / show on re-run ----------
local function is_control_alive()
  return hb_alive(ext_get('ControlProcHB'))
end

if is_control_alive() then
  -- Ask existing instance to show its UI and exit.
  ext_set('ControlUIVisible', '1', false)
  return
end

-- ---------- imgui ----------
local function ctx_ok(c)
  if not c then return false end
  local ok = pcall(reaper.ImGui_GetTime, c)
  return ok
end

local function ensure_ctx_valid()
  if ctx_ok(ctx) then return end
  if ctx then pcall(reaper.ImGui_DestroyContext, ctx) end
  ctx = reaper.ImGui_CreateContext(ctx_name)
end

local function draw_window()
  ensure_ctx_valid()

  -- Respect external request to show (re-run action)
  if ext_get('ControlUIVisible') == '1' then
    state.ui_visible = true
    ext_set('ControlUIVisible', '0', false)
  end

  -- Focus request (from RemoteMixerControl_Show.lua)
  local focus_req = ext_get('ControlUIFocus')
  if focus_req and focus_req ~= '' and focus_req ~= (state.last_focus_req or '') then
    state.last_focus_req = focus_req
    if reaper.ImGui_SetNextWindowFocus then
      pcall(reaper.ImGui_SetNextWindowFocus, ctx)
    end
  end

  if not state.ui_visible then
    return
  end

  -- predictable starting size, and never 0x0
  if reaper.ImGui_SetNextWindowSizeConstraints then
    pcall(reaper.ImGui_SetNextWindowSizeConstraints, ctx, 520, 320, 4096, 4096)
  end
  reaper.ImGui_SetNextWindowSize(ctx, 720, 460, reaper.ImGui_Cond_Appearing())

  local sv, sc = theme.push(ctx, 1.0)
  local began_ok, visible, open = pcall(reaper.ImGui_Begin, ctx, 'ReaperRM Control', true)
  if not began_ok then
    state.ui_visible = false
    theme.pop(ctx, sv, sc)
    return
  end

  if open == false then
    state.ui_visible = false
    ext_set('ControlUIVisible', '0', false)
  end

  if visible then
    ui.section_title(ctx, 'Remote Mixer Control')
    local toolbar_scope = ui.toolbar_begin(ctx, 1.0)
    reaper.ImGui_SameLine(ctx, 0, 8)

    if ui.button_secondary(ctx, state.show_diag and 'Hide diagnostics' or 'Show diagnostics', 1.0) then
      state.show_diag = not state.show_diag
      if state.show_diag then poll_logs() end
    end
    reaper.ImGui_SameLine(ctx, 0, 8)
    if ui.button_secondary(ctx, state.show_scenes and 'Hide scenes' or 'Show scenes', 1.0) then
      state.show_scenes = not state.show_scenes
    end
    reaper.ImGui_SameLine(ctx, 0, 8)
    if ui.button_ghost(ctx, 'Hide window', 1.0) then
      state.ui_visible = false
      ext_set('ControlUIVisible', '0', false)
    end
    ui.toolbar_end(ctx, toolbar_scope)

    reaper.ImGui_Separator(ctx)

    if state.show_scenes then
      draw_scenes_manager()
      reaper.ImGui_Separator(ctx)
    end

    local st = state.status or {}
    reaper.ImGui_Text(ctx, 'Server: ' .. ((st.running and 'running') or 'stopped'))
    ui.caption_muted(ctx, 'URL: ' .. url_for(st))

    local bridge_conn = tostring(ext_get('BridgeConnected')) == '1'
    local bridge_err = tostring(ext_get('BridgeLastError') or '')
    reaper.ImGui_Text(ctx, 'Bridge: ' .. (bridge_conn and 'connected' or 'disconnected'))
    if (not bridge_conn) and bridge_err ~= '' then
      reaper.ImGui_TextWrapped(ctx, 'Bridge error: ' .. bridge_err)
    end

    if ui.button_primary(ctx, 'Start all', 1.0) then
      spawn_daemon()
      poll_status()
      start_bridge()
      ensure_fxpanels_started()
      ext_set('FxReplaceEnabled', '1', true)
    end
    reaper.ImGui_SameLine(ctx)
    if ui.button_secondary(ctx, 'Stop all', 1.0) then
      ext_set('FxPanelsStop', '1', false)
      stop_bridge()
      send_control('stop')
      poll_status()
    end
    reaper.ImGui_SameLine(ctx)
    if ui.button_secondary(ctx, 'Restart server', 1.0) then
      send_control('restart')
      poll_status()
    end

    reaper.ImGui_Separator(ctx)

    local enabled = tostring(ext_get('FxReplaceEnabled')) == '1'
    if ui.button_secondary(ctx, enabled and 'FX replacement: ON' or 'FX replacement: OFF', 1.0) then
      enabled = not enabled
      ext_set('FxReplaceEnabled', enabled and '1' or '0', true)
    end
    reaper.ImGui_SameLine(ctx, 0, 8)
    ui.caption_muted(ctx, string.format('Last updated %.1fs ago', math.max(0, now() - (state.last_poll or 0))))

    if state.error and state.error ~= '' then
      reaper.ImGui_Separator(ctx)
      reaper.ImGui_TextWrapped(ctx, 'Error: ' .. tostring(state.error))
    end

    if state.show_diag then
      reaper.ImGui_Separator(ctx)
      ui.section_title(ctx, 'Diagnostics')
      local child_flags = 0
      if reaper.ImGui_ChildFlags_Border then
        child_flags = reaper.ImGui_ChildFlags_Border()
      elseif reaper.ImGui_ChildFlags_Borders then
        child_flags = reaper.ImGui_ChildFlags_Borders()
      end
      local child_ok, child_visible = pcall(reaper.ImGui_BeginChild, ctx, 'rm_diag', 0, 0, child_flags)
      if child_ok and child_visible then
        reaper.ImGui_TextWrapped(ctx, 'BridgeHB: ' .. tostring(ext_get('BridgeHB')))
        reaper.ImGui_TextWrapped(ctx, 'ControlHB: ' .. tostring(ext_get('ControlHB')))
        reaper.ImGui_TextWrapped(ctx, 'FxPanelsHB: ' .. tostring(ext_get('FxPanelsHB')))
        reaper.ImGui_Separator(ctx)
        if ui.button_secondary(ctx, 'Reload logs', 1.0) then
          poll_logs()
        end
        for _, line in ipairs(state.logs or {}) do
          reaper.ImGui_TextWrapped(ctx, line)
        end
        pcall(reaper.ImGui_EndChild, ctx)
      end
    end
  end

  pcall(reaper.ImGui_End, ctx)
  theme.pop(ctx, sv, sc)
end

-- ---------- main loop ----------
local function control_hb()
  hb_write('ControlHB')
  hb_write('ControlProcHB')
end

local function autostart_once()
  if state.autostart_done then return end
  state.autostart_done = true

  poll_status()
  if not (state.status and state.status.running) then
    spawn_daemon()
    poll_status()
  end

  start_bridge()
  ensure_fxpanels_started()
  ext_set('FxReplaceEnabled', ext_get('FxReplaceEnabled') ~= '0' and '1' or '0', true)
end

local function loop()
  control_hb()
  autostart_once()

  -- Heartbeat so the "Show" helper can detect whether this UI is already running.
  do
    local t_now = now()
    state._alive_last = state._alive_last or 0
    if (t_now - state._alive_last) > 0.5 then
      state._alive_last = t_now
      ext_set('ControlUIAlive', tostring(t_now), false)
    end
  end

  local t = now()
  if (t - state.last_poll) > POLL_INTERVAL then
    state.last_poll = t
    poll_status()
  end
  if state.show_diag and (t - state.last_log_poll) > LOG_POLL_INTERVAL then
    state.last_log_poll = t
    poll_logs()
  end

  draw_window()
  reaper.defer(loop)
end

reaper.atexit(function()
  ext_set('ControlHB', '', false)
  ext_set('ControlProcHB', '', false)
  -- Turn off replacement if the script really stops.
  ext_set('FxPanelsStop', '1', false)
  ext_set('ControlUIAlive', '', false)
end)

-- ensure control UI visible on first run
ext_set('ControlUIVisible', '0', false)
state.ui_visible = true

loop()
