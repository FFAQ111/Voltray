export const shortAddr = (a: string) =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

export const formatTime = (ms: number) => new Date(ms).toLocaleString();

// DR window status relative to now.
export function windowStatus(start: number, end: number): "upcoming" | "active" | "ended" {
  const now = Date.now();
  if (now < start) return "upcoming";
  if (now > end) return "ended";
  return "active";
}
