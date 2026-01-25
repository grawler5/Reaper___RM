export function sClone(obj) {
  try {
    if (globalThis.structuredClone) return structuredClone(obj);
  } catch (e) {
    // ignore
  }
  return JSON.parse(JSON.stringify(obj));
}

export function clamp01(value) {
  const v = Number(value || 0);
  return Math.max(0, Math.min(1, v));
}

export function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}
