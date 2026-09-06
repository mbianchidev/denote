export const SITE_THEME_KEY = "denote-site-theme";

export function readThemePreference(storage = localStorage) {
  const value = storage.getItem(SITE_THEME_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "dark";
}

export function resolveTheme(preference, systemDark) {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function applyTheme(preference) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const render = () => {
    const theme = resolveTheme(preference, media.matches);
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#121315" : "#e9e6df");
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.getAttribute("data-theme-choice") === preference),
      );
    });
  };
  render();
  const listener = () => {
    if (preference === "system") render();
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
