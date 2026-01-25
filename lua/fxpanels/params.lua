local compat = require('fxpanels.compat')

local params = {}

local function norm(s)
  s = tostring(s or '')
  return s:lower()
end

function params.get_norm(track, fx, param)
  return reaper.TrackFX_GetParamNormalized(track, fx, param)
end

function params.set_norm(track, fx, param, value)
  reaper.TrackFX_SetParamNormalized(track, fx, param, compat.clamp(value, 0.0, 1.0))
end

-- Raw value + min/max
function params.get_raw(track, fx, param)
  local val, minv, maxv = reaper.TrackFX_GetParam(track, fx, param)
  return val, minv, maxv
end

function params.set_raw(track, fx, param, raw)
  local _, minv, maxv = params.get_raw(track, fx, param)
  local v = compat.clamp(raw, minv, maxv)
  reaper.TrackFX_SetParam(track, fx, param, v)
end

function params.get_formatted(track, fx, param)
  local _, formatted = reaper.TrackFX_GetFormattedParamValue(track, fx, param, '')
  return formatted
end

function params.get_name(track, fx, param)
  local _, name = reaper.TrackFX_GetParamName(track, fx, param, '')
  return name or ''
end

-- Find first param whose name contains any of the given patterns (case-insensitive).
-- patterns: array of strings
function params.find_param(track, fx, patterns, start_param)
  local n = reaper.TrackFX_GetNumParams(track, fx)
  local start = start_param or 0
  for p = start, n - 1 do
    local name = norm(params.get_name(track, fx, p))
    for _, pat in ipairs(patterns) do
      if name:find(norm(pat), 1, true) then
        return p
      end
    end
  end
  return nil
end

-- Build mapping with caching.
-- spec: { key = {patterns={...}, default=<number>} }
function params.build_map(track, fx, spec, cache, cache_key)
  cache = cache or {}
  local key = cache_key or (tostring(reaper.GetTrackGUID(track)) .. ':' .. tostring(fx))
  if cache[key] then return cache[key] end
  local out = {}
  for k, entry in pairs(spec) do
    local idx = nil
    if entry.patterns then
      idx = params.find_param(track, fx, entry.patterns, entry.start)
    end
    if idx == nil then idx = entry.default end
    out[k] = idx
  end
  cache[key] = out
  return out
end

return params
