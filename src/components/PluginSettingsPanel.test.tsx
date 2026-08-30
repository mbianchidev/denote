import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import catalogJson from "../../packages/plugins/catalog.json";
import {
  assertValidPluginCatalogEntry,
  type PluginCatalogEntry,
} from "@denote/plugin-sdk";
import type { PluginView } from "../types";
import { PluginSettingsPanel } from "./PluginSettingsPanel";

const catalogValue: unknown = catalogJson[0];
assertValidPluginCatalogEntry(catalogValue);
const catalog: PluginCatalogEntry = catalogValue;

function plugin(overrides: Partial<PluginView> = {}): PluginView {
  return {
    catalog,
    status: "not-installed",
    enabled: false,
    error: null,
    approvedPermissions: [],
    settings: {},
    ...overrides,
  };
}

function props(overrides: Partial<Parameters<typeof PluginSettingsPanel>[0]> = {}) {
  return {
    plugins: [plugin()],
    loading: false,
    busyPluginIds: new Set<string>(),
    onEnable: vi.fn().mockResolvedValue(undefined),
    onDisable: vi.fn().mockResolvedValue(undefined),
    onDisableAll: vi.fn().mockResolvedValue(undefined),
    onClearData: vi.fn().mockResolvedValue(undefined),
    onClearCredentials: vi.fn().mockResolvedValue(undefined),
    onUpdateSettings: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    ...overrides,
  };
}

describe("PluginSettingsPanel", () => {
  it("shows catalog metadata and filters plugins", async () => {
    const user = userEvent.setup();
    render(<PluginSettingsPanel {...props()} />);

    expect(
      screen.getByRole("heading", { name: "Reference plugin" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Not stored locally")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search plugins" }), "missing");
    expect(screen.getByText("No plugins match these filters.")).toBeInTheDocument();
  });

  it("requires permission approval before enabling", async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn().mockResolvedValue(undefined);
    render(<PluginSettingsPanel {...props({ onEnable })} />);

    await user.click(screen.getByRole("button", { name: "Enable" }));
    expect(
      screen.getByRole("heading", { name: "Approve permissions?" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Approve and enable" }),
    );

    expect(onEnable).toHaveBeenCalledWith("denote.reference", [
      JSON.stringify({ capability: "commands" }),
      JSON.stringify({ capability: "secure-storage" }),
    ]);
  });

  it("offers package disable and explicit data cleanup", async () => {
    const user = userEvent.setup();
    const onDisable = vi.fn().mockResolvedValue(undefined);
    const onClearData = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <PluginSettingsPanel
        {...props({
          plugins: [plugin({ enabled: true, status: "enabled" })],
          onDisable,
          onClearData,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Disable and remove code" }),
    );
    expect(onDisable).toHaveBeenCalledWith("denote.reference");

    rerender(
      <PluginSettingsPanel
        {...props({
          plugins: [plugin({ enabled: false, status: "disabled" })],
          onDisable,
          onClearData,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete saved data" }));
    await user.click(screen.getByRole("button", { name: "Delete data" }));
    expect(onClearData).toHaveBeenCalledWith("denote.reference");
  });

  it("offers a recovery action that disables every active plugin", async () => {
    const user = userEvent.setup();
    const onDisableAll = vi.fn().mockResolvedValue(undefined);
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [plugin({ enabled: true, status: "enabled" })],
          onDisableAll,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Disable all plugins" }),
    );

    expect(onDisableAll).toHaveBeenCalledOnce();
  });

  it("exposes the in-app usage guide before enablement", async () => {
    const user = userEvent.setup();
    render(<PluginSettingsPanel {...props()} />);

    await user.click(
      screen.getByText("Permissions and guide"),
    );

    expect(screen.getByText("How to use")).toBeInTheDocument();
    expect(screen.getByText("Enablement and permissions")).toBeInTheDocument();
    expect(
      screen.getByText(/downloaded and verified before its code loads/i),
    ).toBeInTheDocument();
  });
});
