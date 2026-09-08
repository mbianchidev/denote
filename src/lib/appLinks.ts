import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

type AppLinkHandler = (uri: string) => void | Promise<void>;
type AppLinkErrorHandler = (error: unknown) => void;

export async function listenForAppLinks(
  onAppLink: AppLinkHandler,
  onError: AppLinkErrorHandler,
): Promise<() => void> {
  let active = true;
  let handling = Promise.resolve();
  const pending = new Set<string>();

  const enqueue = (uris: string[]) => {
    for (const uri of uris) {
      if (!active || pending.has(uri)) {
        continue;
      }
      pending.add(uri);
      handling = handling
        .then(async () => {
          if (active) {
            await onAppLink(uri);
          }
        })
        .catch((error) => {
          if (active) {
            onError(error);
          }
        })
        .finally(() => {
          pending.delete(uri);
        });
    }
  };

  const unlisten = await onOpenUrl(enqueue);
  try {
    enqueue((await getCurrent()) ?? []);
  } catch (error) {
    onError(error);
  }

  return () => {
    active = false;
    unlisten();
  };
}
