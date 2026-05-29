export const shortAddr = (a: string) =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

// Fixed en-US locale so the UI reads the same regardless of browser language.
export const formatTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US");

// 1 SUI = 1e9 MIST. Compact human-readable amount for display only.
export const formatSui = (mist: number) =>
  `${(mist / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SUI`;

// DR window status relative to now.
export function windowStatus(start: number, end: number): "upcoming" | "active" | "ended" {
  const now = Date.now();
  if (now < start) return "upcoming";
  if (now > end) return "ended";
  return "active";
}
