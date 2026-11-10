import { createContext, useCallback, useEffect, useState } from "react";

export const REMOTE_IMAGE_PERMISSION_KEY = "denote-load-remote-images";
export const RemoteImagesAllowedContext = createContext(false);

// SVG image documents cannot inherit the host's CSS custom properties.
export const BLOCKED_REMOTE_IMAGE = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="72" viewBox="0 0 256 72">' +
  '<style>svg{color:#51554d;background:#f8f6f1}text{fill:currentColor}@media(prefers-color-scheme:dark){svg{color:#aaa9a2;background:#181a1d}}</style>' +
  '<text x="128" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15">Remote image blocked</text></svg>',
);

export function isRemoteImageSource(source: string): boolean {
  return /^(?:https?:)?\/\//i.test(source.trim());
}

export function getRemoteImagesAllowed(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  const value = storage.getItem(REMOTE_IMAGE_PERMISSION_KEY);
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  throw new Error("The remote-image privacy setting is invalid. Images remain blocked.");
}

export function useRemoteImagePreference(reportError: (error: unknown) => void) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const refresh = () => {
      try {
        setAllowed(getRemoteImagesAllowed());
      } catch (cause) {
        setAllowed(false);
        reportError(Object.assign(
          new Error("Remote-image privacy settings could not be read. Images remain blocked."),
          { cause },
        ));
      }
    };
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === REMOTE_IMAGE_PERMISSION_KEY) refresh();
    };
    refresh();
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [reportError]);
  const update = useCallback((enabled: boolean) => {
    if (!enabled) setAllowed(false);
    try {
      localStorage.setItem(REMOTE_IMAGE_PERMISSION_KEY, String(enabled));
      setAllowed(enabled);
    } catch (cause) {
      setAllowed(false);
      reportError(Object.assign(
        new Error("The remote-image setting could not be saved. Images are blocked for this session."),
        { cause },
      ));
    }
  }, [reportError]);
  return { allowed, update };
}
