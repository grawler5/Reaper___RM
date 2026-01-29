local registry = {}

-- Central place for mapping FX names (as REAPER reports them) to panel modules.

local panels = {
  rm_saturator = require('fxpanels.panels.rm_saturator'),
  rm_ns = require('fxpanels.panels.rm_ns'),
  rm_compressor2 = require('fxpanels.panels.rm_compressor2'),
  rm_comp2 = require('fxpanels.panels.rm_comp2'),
  rm_compressor = require('fxpanels.panels.rm_compressor'),
  rm_eq2 = require('fxpanels.panels.rm_eq2'),
  rm_eq4 = require('fxpanels.panels.rm_eq4'),
  rm_preamp = require('fxpanels.panels.rm_preamp'),
  rm_1175 = require('fxpanels.panels.rm_1175'),
  rm_la1a = require('fxpanels.panels.rm_la1a'),
  rm_gate = require('fxpanels.panels.rm_gate'),
  rm_deesser = require('fxpanels.panels.rm_deesser'),
  rm_limiter2 = require('fxpanels.panels.rm_limiter2'),
  rm_kicker50hz = require('fxpanels.panels.rm_kicker50hz'),
  rm_delaymachine = require('fxpanels.panels.rm_delaymachine'),
  rm_vox = require('fxpanels.panels.rm_vox'),
  rm_eqt1a = require('fxpanels.panels.rm_eqt1a'),
  rm_lexikan2 = require('fxpanels.panels.rm_lexikan2'),
  rm_air = require('fxpanels.panels.rm_air'),
}

-- Trim + normalize: remove "JS:" prefix, collapse spaces.
local function trim(s)
  return (tostring(s or ''):gsub('^%s+', ''):gsub('%s+$', ''))
end

function registry.normalize_fx_name(name)
  local cleaned = tostring(name or '')
  cleaned = cleaned:gsub('^JS:%s*', '')
  cleaned = cleaned:gsub('^VST3:%s*', '')
  cleaned = cleaned:gsub('^VST:%s*', '')
  cleaned = cleaned:gsub('^AU:%s*', '')
  cleaned = trim(cleaned)
  cleaned = cleaned:gsub('%s+', ' ')
  return cleaned
end

-- Convert to a stable key string.
function registry.key_for_fx_name(name)
  local cleaned = registry.normalize_fx_name(name):lower()
  cleaned = cleaned:gsub('[^%w]+', '_')
  cleaned = cleaned:gsub('_+', '_')
  cleaned = cleaned:gsub('^_', ''):gsub('_$', '')
  return cleaned
end

-- Map arbitrary REAPER FX names to our canonical panel keys.
function registry.match_panel_key(fx_name)
  local k = registry.key_for_fx_name(fx_name)

  -- Aliases / legacy names
  if k:find('em_eq2', 1, true) or k:find('rm_eq2', 1, true) then
    return 'rm_eq2'
  end
  if k:find('rm_saturator', 1, true) then
    return 'rm_saturator'
  end
  if k:find('rm_ns', 1, true) or k:find('rm_noise', 1, true) then
    return 'rm_ns'
  end
  if k:find('rm_compressor2', 1, true) or k:find('rm_comp2', 1, true) then
    return 'rm_compressor2'
  end
  if k:find('rm_compressor', 1, true) then
    return 'rm_compressor'
  end
  if k:find('rm_gate', 1, true) then
    return 'rm_gate'
  end
  if k:find('rm_eq4', 1, true) then
    return 'rm_eq4'
  end
  if k:find('rm_preamp', 1, true) or k:find('preamp', 1, true) then
    return 'rm_preamp'
  end
  if k:find('rm_1175', 1, true) or k:find('1175', 1, true) or k:find('nc76', 1, true) then
    return 'rm_1175'
  end
  if k:find('rm_la1a', 1, true) or k:find('la1a', 1, true) then
    return 'rm_la1a'
  end
  if k:find('rm_deesser', 1, true) then
    return 'rm_deesser'
  end
  if k:find('rm_limiter2', 1, true) then
    return 'rm_limiter2'
  end
  if k:find('rm_kicker', 1, true) or k:find('kicker50hz', 1, true) then
    return 'rm_kicker50hz'
  end
  if k:find('rm_delaymachine', 1, true) or k:find('delaymachine', 1, true) then
    return 'rm_delaymachine'
  end
  if k:find('rm_vox', 1, true) then
    return 'rm_vox'
  end
  if k:find('rm_eqt1a', 1, true) then
    return 'rm_eqt1a'
  end
  if k:find('rm_lexikan2', 1, true) then
    return 'rm_lexikan2'
  end
  if k:find('rm_air', 1, true) then
    return 'rm_air'
  end

  -- If someone adds new panels, allow exact matches.
  if panels[k] ~= nil then
    return k
  end

  return nil
end

function registry.get_panel(panel_key)
  return panels[panel_key]
end

function registry.list_keys()
  local keys = {}
  for key in pairs(panels) do
    keys[#keys + 1] = key
  end
  table.sort(keys)
  return keys
end

-- Supported = any RM_ plugin (or em_eq2 alias). We show generic UI if we don't have a custom panel.
function registry.is_supported_fx(fx_name)
  local cleaned = registry.normalize_fx_name(fx_name)
  -- Most JSFX in this project are named like "RM_Saturator", but REAPER can also display
  -- variants such as "RM Saturator" depending on how the FX is referenced.
  local k = registry.key_for_fx_name(cleaned)

  if cleaned:find("RM_", 1, true) ~= nil then return true end
  if k:sub(1, 3) == "rm_" then return true end
  if k:find("em_eq2", 1, true) then return true end
  return false
end

return registry
