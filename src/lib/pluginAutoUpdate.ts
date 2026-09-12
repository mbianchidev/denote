const STORAGE_KEY = "denote-plugin-auto-update";

export function getPluginAutoUpdateEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function savePluginAutoUpdateEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures (e.g. disabled storage); the in-memory
    // preference for this session still applies.
  }
}
