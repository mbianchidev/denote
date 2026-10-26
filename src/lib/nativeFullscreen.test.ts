import { describe, expect, it, vi } from "vitest";
import { NativeFullscreenHost } from "./nativeFullscreen";

describe("owned native presentation fullscreen", () => {
  it("can reactivate after a development-mode effect cleanup", async () => {
    const window = { isFullscreen: async () => false, setFullscreen: vi.fn(async () => {}) };
    const host = new NativeFullscreenHost(window);
    await host.dispose();
    host.activate();
    const release = await host.enter(new AbortController().signal);
    await release();
    expect(window.setFullscreen).toHaveBeenLastCalledWith(false);
  });

  it("restores the original window state and ignores an obsolete owner's cleanup", async () => {
    let fullscreen = false;
    const window = {
      isFullscreen: vi.fn(async () => fullscreen),
      setFullscreen: vi.fn(async (value: boolean) => { fullscreen = value; }),
    };
    const host = new NativeFullscreenHost(window);
    const first = await host.enter(new AbortController().signal);
    const second = await host.enter(new AbortController().signal);
    await first();
    expect(fullscreen).toBe(true);
    await second();
    expect(fullscreen).toBe(false);
    await second();
    expect(window.setFullscreen).toHaveBeenCalledTimes(3);
  });

  it("retains pre-existing fullscreen and restores an entry cancelled while native work is pending", async () => {
    let fullscreen = true;
    const window = { isFullscreen: async () => fullscreen, setFullscreen: async (value: boolean) => { fullscreen = value; } };
    const host = new NativeFullscreenHost(window);
    const release = await host.enter(new AbortController().signal);
    await release();
    expect(fullscreen).toBe(true);
    fullscreen = false;
    const controller = new AbortController();
    window.setFullscreen = async (value) => { fullscreen = value; if (value) controller.abort(); };
    await expect(host.enter(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fullscreen).toBe(false);
  });

  it("keeps failed restoration retryable instead of forgetting the window lease", async () => {
    let fail = true;
    const window = {
      isFullscreen: async () => false,
      setFullscreen: vi.fn(async (value: boolean) => { if (!value && fail) throw new Error("Synthetic window failure"); }),
    };
    const host = new NativeFullscreenHost(window);
    const release = await host.enter(new AbortController().signal);
    await expect(release()).rejects.toThrow("Synthetic window failure");
    fail = false;
    await release();
    await host.dispose();
    expect(window.setFullscreen).toHaveBeenLastCalledWith(false);
  });
});
