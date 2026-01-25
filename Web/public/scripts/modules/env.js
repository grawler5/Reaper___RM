export function getDebugFlag() {
  try {
    return new URLSearchParams(location.search).get("debug") === "1";
  } catch (e) {
    return false;
  }
}
