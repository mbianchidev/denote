export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "denote-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export function getThemePreference(
  storage: Pick<Storage, "getItem"> = localStorage,
): ThemePreference {
  const stored = storage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : DEFAULT_THEME_PREFERENCE;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  themeColor?.setAttribute("content", theme === "dark" ? "#121315" : "#e9e6df");
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
}

export function systemTheme(
  mediaQuery?: Pick<MediaQueryList, "matches">,
): Theme {
  const query =
    mediaQuery ??
    (typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null);
  return query?.matches === false ? "light" : "dark";
}

export function resolveTheme(
  preference: ThemePreference,
  currentSystemTheme: Theme,
): Theme {
  return preference === "system" ? currentSystemTheme : preference;
}

export function observeSystemTheme(
  onChange: (theme: Theme) => void,
): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (event: MediaQueryListEvent) =>
    onChange(event.matches ? "dark" : "light");
  mediaQuery.addEventListener("change", listener);
  return () => mediaQuery.removeEventListener("change", listener);
}

export function observeThemePreference(
  onChange: (preference: ThemePreference) => void,
): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      onChange(getThemePreference());
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
