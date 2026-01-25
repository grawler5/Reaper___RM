-- Preset store compatible with RemoteMixerLauncher (Web/rm_projects.json).
--
-- Note: RemoteMixerLauncher keeps rm_projects.json in memory while running.
-- When the daemon is running, changes made here may be overwritten by the daemon.
-- We still use the same schema/keying so presets can be shared when possible.

local json = require('fxpanels.json')
local sha1 = require('fxpanels.sha1')

local presets = {}

local sep = package.config:sub(1, 1)
local function script_root()
  return reaper.GetResourcePath() .. sep .. 'Scripts' .. sep .. 'ReaperRM'
end

local function projects_path()
  return script_root() .. sep .. 'Web' .. sep .. 'rm_projects.json'
end

local function read_file(path)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local s = f:read('*a')
  f:close()
  return s
end

local function write_file_atomic(path, content)
  local folder = path:match('^(.*)' .. sep)
  if folder and folder ~= '' then
    reaper.RecursiveCreateDirectory(folder, 0)
  end
  local tmp = path .. '.tmp'
  local f = io.open(tmp, 'wb')
  if not f then return false end
  f:write(content)
  f:close()
  os.remove(path)
  local ok = os.rename(tmp, path)
  if not ok then
    -- Fallback: try copy
    local rf = io.open(tmp, 'rb')
    local wf = io.open(path, 'wb')
    if rf and wf then
      wf:write(rf:read('*a'))
      rf:close()
      wf:close()
      os.remove(tmp)
      return true
    end
    if rf then rf:close() end
    if wf then wf:close() end
    return false
  end
  return true
end

local function get_project_name_and_path()
  local proj, fn = reaper.EnumProjects(-1, '')
  local path = (type(fn) == 'string') and fn or ''
  local _, name = reaper.GetProjectName(proj, '')
  name = (type(name) == 'string' and name ~= '') and name or 'Untitled'
  return name, path
end

local function get_project_id()
  local name, path = get_project_name_and_path()
  local key = (path ~= '' and path) or ('UNSAVED:' .. name)
  return sha1.hex(key), name
end

local function ensure_project_cfg(projects, project_id, project_name)
  local cfg = projects[project_id]
  if type(cfg) ~= 'table' then
    cfg = {
      projectId = project_id,
      projectName = project_name or 'Untitled',
      users = {'main', 'mon1', 'mon2'},
      admin = 'main',
      assignments = {
        main = { all = true, guids = {} },
        mon1 = { all = false, guids = {} },
        mon2 = { all = false, guids = {} },
      },
      ui = { showColorFooter = true, footerIntensity = 0.35 },
      presets = {},
    }
    projects[project_id] = cfg
  end
  if type(cfg.presets) ~= 'table' then cfg.presets = {} end
  return cfg
end

local function make_preset_id()
  -- Match web UI style (UUID v4). Not cryptographically strong, but fine for local presets.
  local function rbyte() return math.random(0, 255) end
  local b = {}
  for i = 1, 16 do b[i] = rbyte() end
  -- Version 4
  b[7] = (b[7] % 16) + 64
  -- Variant 10xx
  b[9] = (b[9] % 64) + 128
  local function hex2(n) return string.format('%02x', n) end
  return table.concat({
    hex2(b[1])..hex2(b[2])..hex2(b[3])..hex2(b[4]),
    hex2(b[5])..hex2(b[6]),
    hex2(b[7])..hex2(b[8]),
    hex2(b[9])..hex2(b[10]),
    hex2(b[11])..hex2(b[12])..hex2(b[13])..hex2(b[14])..hex2(b[15])..hex2(b[16]),
  }, '-')
end

function presets.load_projects()
  local path = projects_path()
  local raw = read_file(path)
  local data = raw and json.decode(raw) or nil
  if type(data) ~= 'table' then data = {} end
  return data
end

function presets.save_projects(projects)
  local path = projects_path()
  local payload = json.encode(projects, { indent = 2 })
  return write_file_atomic(path, payload)
end

function presets.get_fx_key_from_name(fx_name)
  fx_name = tostring(fx_name or ''):match('^%s*(.-)%s*$')
  return fx_name:lower()
end

function presets.list(fx_key)
  local projects = presets.load_projects()
  local pid, pname = get_project_id()
  local cfg = ensure_project_cfg(projects, pid, pname)
  local list = cfg.presets[fx_key]
  if type(list) ~= 'table' then return {}, projects, pid end
  -- Normalize
  local out = {}
  for _, p in ipairs(list) do
    if type(p) == 'table' and p.name then
      out[#out + 1] = p
    end
  end
  return out, projects, pid
end

function presets.save(fx_key, name, params)
  name = tostring(name or 'Preset'):match('^%s*(.-)%s*$')
  if name == '' then name = 'Preset' end
  local list, projects, pid = presets.list(fx_key)
  local _, pname = get_project_id()
  local cfg = ensure_project_cfg(projects, pid, pname)

  local new_list = {}
  for _, p in ipairs(list) do
    if tostring(p.name) ~= name then
      new_list[#new_list + 1] = p
    end
  end
  new_list[#new_list + 1] = {
    id = make_preset_id(),
    name = name,
    params = params or {},
  }
  cfg.presets[fx_key] = new_list
  presets.save_projects(projects)
  return new_list
end

function presets.delete(fx_key, preset_id)
  local list, projects, pid = presets.list(fx_key)
  local _, pname = get_project_id()
  local cfg = ensure_project_cfg(projects, pid, pname)
  local new_list = {}
  for _, p in ipairs(list) do
    if tostring(p.id) ~= tostring(preset_id) then
      new_list[#new_list + 1] = p
    end
  end
  cfg.presets[fx_key] = new_list
  presets.save_projects(projects)
  return new_list
end

return presets
