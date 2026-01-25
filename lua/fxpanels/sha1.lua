-- Portable SHA1 (hex) implementation for REAPER Lua.
--
-- Some REAPER builds ship Lua with 32-bit integers. In that case, unsigned
-- 32-bit constants (e.g. 0xEFCDAB89) cannot be represented as integers and
-- become floats. Lua bitwise operators only accept integers, so naive SHA1
-- implementations can crash with: "number has no integer representation".
--
-- This implementation avoids Lua bitwise operators entirely (unless bit32 is
-- available, in which case we use it for speed). All internal state is kept
-- as uint32 values in the range [0, 2^32-1] stored as Lua numbers.

local sha1 = {}

local TWO32 = 4294967296.0
local TWO24 = 16777216.0
local TWO16 = 65536.0
local TWO8  = 256.0

local has_bit32 = type(bit32) == 'table'
  and type(bit32.bxor) == 'function'
  and type(bit32.band) == 'function'
  and type(bit32.bor) == 'function'
  and type(bit32.lshift) == 'function'
  and type(bit32.rshift) == 'function'

local function u32(x)
  -- Ensure 0 <= x < 2^32
  x = x % TWO32
  if x < 0 then x = x + TWO32 end
  return x
end

-- Bitwise ops over uint32 numbers.
local function bxor(a, b)
  if has_bit32 then return u32(bit32.bxor(a, b)) end
  a, b = u32(a), u32(b)
  local res, bit = 0.0, 1.0
  for _ = 1, 32 do
    local aa = a % 2
    local bb = b % 2
    if aa ~= bb then res = res + bit end
    a = (a - aa) / 2
    b = (b - bb) / 2
    bit = bit * 2
  end
  return res
end

local function band(a, b)
  if has_bit32 then return u32(bit32.band(a, b)) end
  a, b = u32(a), u32(b)
  local res, bit = 0.0, 1.0
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

local function bor(a, b)
  if has_bit32 then return u32(bit32.bor(a, b)) end
  a, b = u32(a), u32(b)
  local res, bit = 0.0, 1.0
  for _ = 1, 32 do
    local aa = a % 2
    local bb = b % 2
    if aa == 1 or bb == 1 then res = res + bit end
    a = (a - aa) / 2
    b = (b - bb) / 2
    bit = bit * 2
  end
  return res
end

local function bnot(a)
  -- 0xFFFFFFFF - a
  return u32((TWO32 - 1) - u32(a))
end

local function lshift(a, n)
  if has_bit32 then return u32(bit32.lshift(a, n)) end
  return u32(u32(a) * (2.0 ^ n))
end

local function rshift(a, n)
  if has_bit32 then return u32(bit32.rshift(a, n)) end
  return math.floor(u32(a) / (2.0 ^ n))
end

local function rol(a, n)
  if has_bit32 and type(bit32.lrotate) == 'function' then
    return u32(bit32.lrotate(a, n))
  end
  a = u32(a)
  n = n % 32
  if n == 0 then return a end
  return u32(lshift(a, n) + rshift(a, 32 - n))
end

local function str_to_bytes(s)
  local t = {}
  for i = 1, #s do t[i] = s:byte(i) end
  return t
end

local function bytes_to_u32(b1, b2, b3, b4)
  return u32(b1 * TWO24 + b2 * TWO16 + b3 * TWO8 + b4)
end

local function u32_to_bytes(x)
  x = u32(x)
  local b1 = math.floor(x / TWO24) % 256
  local b2 = math.floor(x / TWO16) % 256
  local b3 = math.floor(x / TWO8) % 256
  local b4 = math.floor(x) % 256
  return b1, b2, b3, b4
end

local function pad_message(bytes)
  local bit_len = #bytes * 8
  bytes[#bytes + 1] = 0x80
  while ((#bytes * 8) % 512) ~= 448 do
    bytes[#bytes + 1] = 0x00
  end

  -- 64-bit big-endian length split into two 32-bit words.
  local hi = math.floor(bit_len / TWO32)
  local lo = bit_len - hi * TWO32

  local b1, b2, b3, b4 = u32_to_bytes(hi)
  bytes[#bytes + 1] = b1
  bytes[#bytes + 1] = b2
  bytes[#bytes + 1] = b3
  bytes[#bytes + 1] = b4

  b1, b2, b3, b4 = u32_to_bytes(lo)
  bytes[#bytes + 1] = b1
  bytes[#bytes + 1] = b2
  bytes[#bytes + 1] = b3
  bytes[#bytes + 1] = b4

  return bytes
end

local function hex_u32(x)
  local b1, b2, b3, b4 = u32_to_bytes(x)
  return string.format('%02x%02x%02x%02x', b1, b2, b3, b4)
end

function sha1.hex(msg)
  msg = tostring(msg or '')
  local bytes = pad_message(str_to_bytes(msg))

  -- SHA-1 initial hash values (unsigned).
  local h0 = 1732584193.0
  local h1 = 4023233417.0
  local h2 = 2562383102.0
  local h3 = 271733878.0
  local h4 = 3285377520.0

  local w = {}
  for chunk = 1, #bytes, 64 do
    for i = 0, 15 do
      local o = chunk + i * 4
      w[i] = bytes_to_u32(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
    end
    for i = 16, 79 do
      w[i] = rol(bxor(bxor(bxor(w[i - 3], w[i - 8]), w[i - 14]), w[i - 16]), 1)
    end

    local a, b, c, d, e = h0, h1, h2, h3, h4

    for i = 0, 79 do
      local f, k
      if i <= 19 then
        f = bor(band(b, c), band(bnot(b), d))
        k = 1518500249.0
      elseif i <= 39 then
        f = bxor(bxor(b, c), d)
        k = 1859775393.0
      elseif i <= 59 then
        f = bor(bor(band(b, c), band(b, d)), band(c, d))
        k = 2400959708.0
      else
        f = bxor(bxor(b, c), d)
        k = 3395469782.0
      end

      local temp = u32(rol(a, 5) + f + e + k + w[i])
      e = d
      d = c
      c = rol(b, 30)
      b = a
      a = temp
    end

    h0 = u32(h0 + a)
    h1 = u32(h1 + b)
    h2 = u32(h2 + c)
    h3 = u32(h3 + d)
    h4 = u32(h4 + e)
  end

  return hex_u32(h0) .. hex_u32(h1) .. hex_u32(h2) .. hex_u32(h3) .. hex_u32(h4)
end

return sha1
