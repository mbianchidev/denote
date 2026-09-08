import { beforeEach, describe, expect, it, vi } from "vitest";

const deepLinks = vi.hoisted(() => ({
  getCurrent: vi.fn<() => Promise<string[] | null>>(),
  listener: null as ((uris: string[]) => void) | null,
  unlisten: vi.fn(),
  onOpenUrl: vi.fn(
    async (listener: (uris: string[]) => void): Promise<() => void> => {
      deepLinks.listener = listener;
      return deepLinks.unlisten;
    },
  ),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: deepLinks.getCurrent,
  onOpenUrl: deepLinks.onOpenUrl,
}));

import { listenForAppLinks } from "./appLinks";

describe("listenForAppLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deepLinks.listener = null;
    deepLinks.getCurrent.mockResolvedValue(null);
  });

  it("handles the link that launched the application", async () => {
    deepLinks.getCurrent.mockResolvedValue([
      "denote:///synthetic-vault/linked%20note.md",
    ]);
    const handler = vi.fn().mockResolvedValue(undefined);

    const stop = await listenForAppLinks(handler, vi.fn());

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith(
        "denote:///synthetic-vault/linked%20note.md",
      );
    });
    stop();
    expect(deepLinks.unlisten).toHaveBeenCalledOnce();
  });

  it("serializes runtime links and ignores an in-flight duplicate", async () => {
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const handler = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);

    await listenForAppLinks(handler, vi.fn());
    deepLinks.listener?.([
      "denote:///synthetic-vault/first.md",
      "denote:///synthetic-vault/first.md",
      "denote:///synthetic-vault/second.md",
    ]);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    finishFirst();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenNthCalledWith(
        2,
        "denote:///synthetic-vault/second.md",
      );
    });
  });
});
