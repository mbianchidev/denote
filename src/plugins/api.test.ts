import { describe, expect, it, vi } from "vitest";
import { PluginRegistry, type DenotePlugin } from "./api";

describe("PluginRegistry", () => {
  it("activates only explicitly enabled plugins and cleans them up", async () => {
    const activate = vi.fn();
    const cleanup = vi.fn();
    const plugin: DenotePlugin = {
      manifest: {
        id: "example",
        name: "Example",
        version: "1.0.0",
        description: "Example optional plugin",
        capabilities: ["commands"],
      },
      activate: (context) => {
        activate();
        context.registerCleanup(cleanup);
      },
    };
    const registry = new PluginRegistry();
    registry.register(plugin);

    expect(registry.list()[0]).toMatchObject({ enabled: false, active: false });

    await registry.setEnabled("example", true, {
      vaultPath: "/vault",
      reportError: vi.fn(),
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(registry.list()[0]).toMatchObject({ enabled: true, active: true });

    await registry.setEnabled("example", false, {
      vaultPath: "/vault",
      reportError: vi.fn(),
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(registry.list()[0]).toMatchObject({ enabled: false, active: false });
  });
});
