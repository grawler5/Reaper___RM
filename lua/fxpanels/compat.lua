local compat = {}

-- Some ReaImGui enums are numbers in some builds and functions in others.
function compat.resolve_enum(v)
  if type(v) == 'number' then return v end
  if type(v) == 'function' then
    local ok, res = pcall(v)
    if ok and type(res) == 'number' then return res end
  end
  return nil
end

-- Cursor screen position compatibility (avoid SetCursorPos/SetCursorScreenPos for 0.10.x)
function compat.get_cursor_screen_pos(ctx)
  if reaper.ImGui_GetCursorScreenPos then
    local x, y = reaper.ImGui_GetCursorScreenPos(ctx)
    return x or 0, y or 0
  end
  if reaper.ImGui_GetWindowPos and reaper.ImGui_GetCursorPos then
    local wx, wy = reaper.ImGui_GetWindowPos(ctx)
    local cx, cy = reaper.ImGui_GetCursorPos(ctx)
    return (wx or 0) + (cx or 0), (wy or 0) + (cy or 0)
  end
  return 0, 0
end


local function has_bit32()
  return type(bit32) == 'table'
     and type(bit32.band) == 'function'
     and type(bit32.bor) == 'function'
end

-- Safe 32-bit band/bor for Lua builds where bitwise operators are unavailable
-- or where numbers may not be representable as integers (REAPER Lua on macOS).
local function to_u32(x)
  x = tonumber(x) or 0
  -- keep in 0..2^32-1 range
  x = x % 4294967296
  if x < 0 then x = x + 4294967296 end
  return x
end

local function band_u32(a, b)
  a, b = to_u32(a), to_u32(b)
  local res = 0
  local bit = 1
  for _ = 1, 32 do
    local aa = a % 2
    local bb = b % 2
    if aa == 1 and bb == 1 then res = res + bit end
    a = (a - aa) / 2
    b = (b - bb) / 2
    bit = bit * 2
  end
  return res
end

local function bor_u32(a, b)
  a, b = to_u32(a), to_u32(b)
  local res = 0
  local bit = 1
  for _ = 1, 32 do
    local aa = a % 2
    local bb = b % 2
    if (aa == 1) or (bb == 1) then res = res + bit end
    a = (a - aa) / 2
    b = (b - bb) / 2
    bit = bit * 2
  end
  return res
end

function compat.band(a, b)
  if has_bit32() then return bit32.band(a, b) end
  return band_u32(a, b)
end

function compat.bor(a, b)
  if has_bit32() then return bit32.bor(a, b) end
  return bor_u32(a, b)
end

function compat.clamp(x, lo, hi)
  if x < lo then return lo end
  if x > hi then return hi end
  return x
end

function compat.try(fn, ...)
  local ok, res1, res2, res3, res4 = pcall(fn, ...)
  if not ok then return nil end
  return res1, res2, res3, res4
end

function compat.has_drawlist()
  return reaper.ImGui_GetWindowDrawList ~= nil
     and (reaper.ImGui_DrawList_AddLine ~= nil or reaper.ImGui_DrawList_AddRect ~= nil)
     and (reaper.ImGui_ColorConvertDouble4ToU32 ~= nil)
end

-- Keep helper for legacy code, but avoid using it in panels on ReaImGui 0.10.x if possible.
function compat.set_cursor_screen_pos(ctx, x, y)
  if reaper.ImGui_SetCursorScreenPos then
    return reaper.ImGui_SetCursorScreenPos(ctx, x, y)
  end
  if reaper.ImGui_SetCursorPos and reaper.ImGui_GetWindowPos then
    local wx, wy = reaper.ImGui_GetWindowPos(ctx)
    if type(wx) == 'number' and type(wy) == 'number' then
      return reaper.ImGui_SetCursorPos(ctx, (x or 0) - wx, (y or 0) - wy)
    end
  end
end

return compat