const RELEASES_URL = "https://github.com/mbianchidev/denote/releases";

export function resolveReleaseDownloads(contract, release) {
  if (
    contract?.schemaVersion !== 1 ||
    contract.repository !== "mbianchidev/denote" ||
    !Array.isArray(contract.downloads)
  ) {
    throw new Error("The download contract is invalid.");
  }
  if (
    release?.draft ||
    release?.prerelease ||
    typeof release?.tag_name !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
    !Array.isArray(release.assets)
  ) {
    throw new Error("GitHub did not return a stable Denote release.");
  }
  const version = release.tag_name.slice(1);
  const assets = new Map();
  for (const asset of release.assets) {
    if (typeof asset?.name !== "string" || typeof asset?.browser_download_url !== "string") {
      continue;
    }
    if (assets.has(asset.name)) {
      throw new Error(`The release contains duplicate asset ${asset.name}.`);
    }
    assets.set(asset.name, asset.browser_download_url);
  }
  const downloads = {};
  for (const spec of contract.downloads) {
    const name = renderName(spec.fileName, version);
    const url = assets.get(name);
    if (!url || !isOfficialAssetUrl(url, release.tag_name, name)) {
      throw new Error(`${spec.label} is unavailable in ${release.tag_name}.`);
    }
    downloads[spec.id] = { ...spec, name, url };
  }
  return { tag: release.tag_name, version, downloads, releasesUrl: release.html_url ?? RELEASES_URL };
}

export function detectRecommendedDownload(platform, userAgent, architecture = "") {
  const source = `${platform} ${userAgent}`.toLowerCase();
  const arch = architecture.toLowerCase();
  if (source.includes("win")) return "windows-x64";
  if (source.includes("linux")) return "linux-appimage-x64";
  if (source.includes("mac")) {
    if (arch.includes("arm") || arch.includes("aarch64")) return "macos-aarch64";
    if (arch.includes("x86") || arch.includes("intel")) return "macos-x64";
  }
  return null;
}

function renderName(template, version) {
  if (
    typeof template !== "string" ||
    !template.includes("{version}") ||
    template.includes("/") ||
    template.includes("\\")
  ) {
    throw new Error("The download filename template is invalid.");
  }
  return template.replaceAll("{version}", version);
}

function isOfficialAssetUrl(value, tag, name) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname ===
        `/mbianchidev/denote/releases/download/${tag}/${encodeURIComponent(name).replaceAll("%2F", "/")}` &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
