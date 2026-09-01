export const DEFAULT_OUTLINE_WIDTH = 280;
export const MIN_OUTLINE_WIDTH = 180;
export const MAX_OUTLINE_WIDTH = 480;

const STORAGE_KEY = "denote-outline-width";

export function clampOutlineWidth(width: number): number {
  return Math.min(
    MAX_OUTLINE_WIDTH,
    Math.max(MIN_OUTLINE_WIDTH, Math.round(width)),
  );
}

export function getOutlineWidth(): number {
  try {
    const stored = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
    return Number.isFinite(stored)
      ? clampOutlineWidth(stored)
      : DEFAULT_OUTLINE_WIDTH;
  } catch {
    return DEFAULT_OUTLINE_WIDTH;
  }
}

export function saveOutlineWidth(width: number): number {
  const clamped = clampOutlineWidth(width);
  localStorage.setItem(STORAGE_KEY, String(clamped));
  return clamped;
}
