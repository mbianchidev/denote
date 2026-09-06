import { detectRecommendedDownload, resolveReleaseDownloads } from "./downloads.js";
import { applyTheme, readThemePreference, SITE_THEME_KEY } from "./theme.js";

const RELEASES_URL = "https://github.com/mbianchidev/denote/releases";
let disposeTheme = applyTheme(readThemePreference());

for (const button of document.querySelectorAll("[data-theme-choice]")) {
  button.addEventListener("click", () => {
    const preference = button.getAttribute("data-theme-choice");
    if (!["light", "dark", "system"].includes(preference)) return;
    localStorage.setItem(SITE_THEME_KEY, preference);
    disposeTheme();
    disposeTheme = applyTheme(preference);
  });
}

void loadDownloads();

async function loadDownloads() {
  const status = document.querySelector("#download-status");
  try {
    const [contractResponse, releaseResponse] = await Promise.all([
      fetch("./release-assets.json", { cache: "no-store" }),
      fetch("https://api.github.com/repos/mbianchidev/denote/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      }),
    ]);
    if (!contractResponse.ok || !releaseResponse.ok) {
      throw new Error("Release metadata could not be loaded.");
    }
    const result = resolveReleaseDownloads(
      await contractResponse.json(),
      await releaseResponse.json(),
    );
    for (const [id, download] of Object.entries(result.downloads)) {
      const link = document.querySelector(`[data-download-id="${id}"]`);
      if (!link) continue;
      link.href = download.url;
      link.textContent =
        id.startsWith("linux-") && link.closest(".linux-downloads")
          ? link.textContent
          : `Download ${result.version}`;
    }
    const architecture =
      navigator.userAgentData?.architecture ??
      (navigator.userAgent.includes("ARM") ? "arm" : "");
    const recommended = detectRecommendedDownload(
      navigator.platform,
      navigator.userAgent,
      architecture,
    );
    if (recommended) {
      document
        .querySelector(`[data-download-card="${recommended}"]`)
        ?.setAttribute("data-recommended", "true");
    }
    status.textContent = `Latest stable release: Denote ${result.version}.`;
  } catch (error) {
    status.setAttribute("role", "alert");
    status.innerHTML = "";
    status.append(
      document.createTextNode(
        "The expected release packages are unavailable right now. ",
      ),
      Object.assign(document.createElement("a"), {
        href: RELEASES_URL,
        textContent: "Open GitHub Releases.",
      }),
    );
    console.error("Unable to resolve Denote downloads:", error);
  }
}
