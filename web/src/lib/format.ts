export const shortAddr = (a: string) =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

// Fixed en-US locale so the UI reads the same regardless of browser language.
export const formatTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US");

// Override the browser-native (locale-dependent) constraint message with English.
export const onInvalidEn = (e: { currentTarget: HTMLInputElement }) =>
  e.currentTarget.setCustomValidity("Value must be greater than or equal to 1.");
export const clearValidity = (e: { currentTarget: HTMLInputElement }) =>
  e.currentTarget.setCustomValidity("");

// DR window status relative to now.
export function windowStatus(start: number, end: number): "upcoming" | "active" | "ended" {
  const now = Date.now();
  if (now < start) return "upcoming";
  if (now > end) return "ended";
  return "active";
}
