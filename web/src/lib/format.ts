export const shortAddr = (a: string) =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

// Fixed en-US locale so the UI reads the same regardless of browser language.
export const formatTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US");

// Rewards are denominated in USDC (6 decimals). Base unit is µUSDC; this renders a
// compact human-readable USDC amount for display only.
export const formatUsdc = (micro: number) =>
  `${(micro / 1e6).toLocaleString("en-US", { maximumFractionDigits: 4 })} USDC`;

// DR window status relative to now.
export function windowStatus(start: number, end: number): "upcoming" | "active" | "ended" {
  const now = Date.now();
  if (now < start) return "upcoming";
  if (now > end) return "ended";
  return "active";
}
