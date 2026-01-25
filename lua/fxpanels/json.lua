-- Minimal JSON (decode/encode) for ReaperRM.
-- Supports: objects, arrays, strings, numbers, booleans, null.

local json = {}

local function decode_error(str, idx, msg)
  error(string.format('json decode error at %d: %s', idx or -1, msg or 'invalid'), 0)
end

local function skip_ws(str, idx)
  local len = #str
  while idx <= len do
    local c = str:sub(idx, idx)
    if c == ' ' or c == '\n' or c == '\r' or c == '\t' then
      idx = idx + 1
    else
      break
    end
  end
  return idx
end

local function parse_string(str, idx)
  idx = idx + 1 -- skip opening quote
  local out = {}
  local len = #str
  while idx <= len do
    local c = str:sub(idx, idx)
    if c == '"' then
      return table.concat(out), idx + 1
    elseif c == '\\' then
      local esc = str:sub(idx + 1, idx + 1)
      if esc == '"' or esc == '\\' or esc == '/' then
        out[#out + 1] = esc
        idx = idx + 2
      elseif esc == 'b' then out[#out + 1] = '\b'; idx = idx + 2
      elseif esc == 'f' then out[#out + 1] = '\f'; idx = idx + 2
      elseif esc == 'n' then out[#out + 1] = '\n'; idx = idx + 2
      elseif esc == 'r' then out[#out + 1] = '\r'; idx = idx + 2
      elseif esc == 't' then out[#out + 1] = '\t'; idx = idx + 2
      elseif esc == 'u' then
        local hex = str:sub(idx + 2, idx + 5)
        if not hex:match('^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]$') then
          decode_error(str, idx, 'invalid unicode escape')
        end
        local code = tonumber(hex, 16)
        -- Basic BMP only; encode as UTF-8.
        if code < 0x80 then
          out[#out + 1] = string.char(code)
        elseif code < 0x800 then
          out[#out + 1] = string.char(0xC0 + (code >> 6), 0x80 + (code & 0x3F))
        else
          out[#out + 1] = string.char(0xE0 + (code >> 12), 0x80 + ((code >> 6) & 0x3F), 0x80 + (code & 0x3F))
        end
        idx = idx + 6
      else
        decode_error(str, idx, 'invalid escape')
      end
    else
      out[#out + 1] = c
      idx = idx + 1
    end
  end
  decode_error(str, idx, 'unterminated string')
end

local function parse_number(str, idx)
  local s, e = str:find('^-?%d+%.?%d*[eE]?[+-]?%d*', idx)
  if not s then
    decode_error(str, idx, 'invalid number')
  end
  local num = tonumber(str:sub(s, e))
  if num == nil then
    decode_error(str, idx, 'invalid number')
  end
  return num, e + 1
end

local parse_value

local function parse_array(str, idx)
  idx = idx + 1
  local out = {}
  idx = skip_ws(str, idx)
  if str:sub(idx, idx) == ']' then
    return out, idx + 1
  end
  while true do
    local v
    v, idx = parse_value(str, idx)
    out[#out + 1] = v
    idx = skip_ws(str, idx)
    local c = str:sub(idx, idx)
    if c == ']' then
      return out, idx + 1
    elseif c == ',' then
      idx = skip_ws(str, idx + 1)
    else
      decode_error(str, idx, 'expected , or ]')
    end
  end
end

local function parse_object(str, idx)
  idx = idx + 1
  local out = {}
  idx = skip_ws(str, idx)
  if str:sub(idx, idx) == '}' then
    return out, idx + 1
  end
  while true do
    if str:sub(idx, idx) ~= '"' then
      decode_error(str, idx, 'expected string key')
    end
    local key
    key, idx = parse_string(str, idx)
    idx = skip_ws(str, idx)
    if str:sub(idx, idx) ~= ':' then
      decode_error(str, idx, 'expected :')
    end
    idx = skip_ws(str, idx + 1)
    local val
    val, idx = parse_value(str, idx)
    out[key] = val
    idx = skip_ws(str, idx)
    local c = str:sub(idx, idx)
    if c == '}' then
      return out, idx + 1
    elseif c == ',' then
      idx = skip_ws(str, idx + 1)
    else
      decode_error(str, idx, 'expected , or }')
    end
  end
end

parse_value = function(str, idx)
  idx = skip_ws(str, idx)
  local c = str:sub(idx, idx)
  if c == '"' then
    return parse_string(str, idx)
  elseif c == '{' then
    return parse_object(str, idx)
  elseif c == '[' then
    return parse_array(str, idx)
  elseif c == '-' or c:match('%d') then
    return parse_number(str, idx)
  elseif str:sub(idx, idx + 3) == 'true' then
    return true, idx + 4
  elseif str:sub(idx, idx + 4) == 'false' then
    return false, idx + 5
  elseif str:sub(idx, idx + 3) == 'null' then
    return nil, idx + 4
  end
  decode_error(str, idx, 'unexpected character')
end

function json.decode(str)
  if type(str) ~= 'string' then return nil end
  local ok, res = pcall(function()
    local v, idx = parse_value(str, 1)
    idx = skip_ws(str, idx)
    if idx <= #str then
      decode_error(str, idx, 'trailing garbage')
    end
    return v
  end)
  if ok then return res end
  return nil
end

local function encode_string(s)
  s = tostring(s)
  s = s:gsub('\\', '\\\\')
  s = s:gsub('"', '\\"')
  s = s:gsub('\n', '\\n')
  s = s:gsub('\r', '\\r')
  s = s:gsub('\t', '\\t')
  return '"' .. s .. '"'
end

local function is_array(t)
  if type(t) ~= 'table' then return false end
  local n = 0
  for k, _ in pairs(t) do
    if type(k) ~= 'number' then return false end
    if k > n then n = k end
  end
  return true, n
end

local function encode_value(v, out, indent, depth)
  local tv = type(v)
  if v == nil then
    out[#out + 1] = 'null'
  elseif tv == 'string' then
    out[#out + 1] = encode_string(v)
  elseif tv == 'number' then
    out[#out + 1] = tostring(v)
  elseif tv == 'boolean' then
    out[#out + 1] = v and 'true' or 'false'
  elseif tv == 'table' then
    local arr, n = is_array(v)
    if arr then
      out[#out + 1] = '['
      for i = 1, n do
        if i > 1 then out[#out + 1] = ',' end
        if indent then out[#out + 1] = '\n' .. string.rep(' ', (depth + 1) * indent) end
        encode_value(v[i], out, indent, depth + 1)
      end
      if indent and n > 0 then out[#out + 1] = '\n' .. string.rep(' ', depth * indent) end
      out[#out + 1] = ']'
    else
      out[#out + 1] = '{'
      local first = true
      for k, val in pairs(v) do
        if not first then out[#out + 1] = ',' end
        first = false
        if indent then out[#out + 1] = '\n' .. string.rep(' ', (depth + 1) * indent) end
        out[#out + 1] = encode_string(k)
        out[#out + 1] = ':'
        if indent then out[#out + 1] = ' ' end
        encode_value(val, out, indent, depth + 1)
      end
      if indent and not first then out[#out + 1] = '\n' .. string.rep(' ', depth * indent) end
      out[#out + 1] = '}'
    end
  else
    out[#out + 1] = encode_string(tostring(v))
  end
end

function json.encode(v, opts)
  local indent = nil
  if opts and opts.indent then indent = tonumber(opts.indent) end
  local out = {}
  encode_value(v, out, indent, 0)
  return table.concat(out)
end

return json
