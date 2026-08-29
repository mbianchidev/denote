interface ShortcutEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
  key?: string;
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

export function isCommandPaletteShortcut(
  event: ShortcutEvent,
  platform: string,
): boolean {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac
    ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyP"
    : event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyP";
}

export type EditorZoomShortcut = "in" | "out" | "reset";

export function editorZoomShortcut(
  event: ShortcutEvent,
  platform: string,
): EditorZoomShortcut | null {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  const primaryModifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!primaryModifier || event.altKey) {
    return null;
  }
  if (event.key && event.key !== "Unidentified") {
    if (event.key === "+" || event.key === "=") {
      return "in";
    }
    if (event.key === "-") {
      return "out";
    }
    if (event.key === "0") {
      return "reset";
    }
    return null;
  }
  if (event.code === "Equal" || event.code === "NumpadAdd") {
    return "in";
  }
  if (
    !event.shiftKey &&
    (event.code === "Minus" || event.code === "NumpadSubtract")
  ) {
    return "out";
  }
  if (
    !event.shiftKey &&
    (event.code === "Digit0" || event.code === "Numpad0")
  ) {
    return "reset";
  }
  return null;
}

export function isNewFileShortcut(
  event: ShortcutEvent,
  platform: string,
): boolean {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac
    ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyN"
    : event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyN";
}

export function isNewTabShortcut(
  event: ShortcutEvent,
  platform: string,
): boolean {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isMac
    ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyT"
    : event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyT";
}
