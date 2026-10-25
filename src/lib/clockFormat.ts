export function formatClockDuration(milliseconds: number, roundUp = false): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Invalid clock duration.");
  const seconds = roundUp ? Math.ceil(milliseconds / 1_000) : Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 3_600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
