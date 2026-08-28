interface ShortcutEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
}

export function isReplaceShortcut(
  event: ShortcutEvent,
  platform: string,
): boolean {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac
    ? event.metaKey &&
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.code === "KeyF"
    : event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyH";
}

export function isSearchShortcut(
  event: ShortcutEvent,
  platform: string,
): boolean {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac
    ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyF"
    : event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyF";
}
