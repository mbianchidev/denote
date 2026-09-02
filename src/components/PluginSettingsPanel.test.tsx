import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import catalogJson from "../../packages/plugins/catalog.json";
import {
  assertValidPluginCatalogEntry,
  type PluginBundle,
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
    hasCredentials: false,
    ...overrides,
  };
}

function props(overrides: Partial<Parameters<typeof PluginSettingsPanel>[0]> = {}) {
  return {
    plugins: [plugin()],
    bundles: [],
    activeProject: null,
    loading: false,
    busyPluginIds: new Set<string>(),
    onEnable: vi.fn().mockResolvedValue(undefined),
    onDisable: vi.fn().mockResolvedValue(undefined),
    onDisableAll: vi.fn().mockResolvedValue(undefined),
    onClearData: vi.fn().mockResolvedValue(undefined),
    onClearCredentials: vi.fn().mockResolvedValue(undefined),
    onUpdateSettings: vi.fn().mockResolvedValue(undefined),
    onImportSettings: vi.fn().mockResolvedValue(undefined),
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

    const search = screen.getByRole("searchbox", { name: "Search plugins" });
    await user.type(search, "missing");
    expect(screen.getByText("No plugins match these filters.")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "synthetic value");
    expect(
      screen.getByRole("heading", { name: "Reference plugin" }),
    ).toBeInTheDocument();
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
      { capability: "commands" },
      { capability: "sidebar" },
      { capability: "status" },
      { capability: "editor-decoration" },
      { capability: "note-events" },
      { capability: "secure-storage" },
    ]);
  });

  it("describes and approves focused project context access", async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn().mockResolvedValue(undefined);
    const projectContextCatalog = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        permissions: [{ capability: "project-context" } as const],
      },
    };
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [plugin({ catalog: projectContextCatalog })],
          onEnable,
        })}
      />,
    );

    await user.click(screen.getByText("Permissions and guide"));
    expect(
      screen.getByText("Observe the focused project root"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enable" }));
    await user.click(
      screen.getByRole("button", { name: "Approve and enable" }),
    );

    expect(onEnable).toHaveBeenCalledWith("denote.reference", [
      { capability: "project-context" },
    ]);
  });

  it("shows code tooling roles only for a focused project", () => {
    const bundle: PluginBundle = {
      id: "code-tooling",
      name: "Code tooling",
      categories: ["code"],
      roles: [
        { id: "git", name: "Git", candidatePluginIds: [] },
        {
          id: "terminal",
          name: "Terminal",
          candidatePluginIds: ["denote.reference"],
        },
      ],
    };
    const { rerender } = render(
      <PluginSettingsPanel {...props({ bundles: [bundle] })} />,
    );

    expect(
      screen.queryByRole("heading", { name: "Code tooling" }),
    ).not.toBeInTheDocument();

    rerender(
      <PluginSettingsPanel
        {...props({
          bundles: [bundle],
          activeProject: {
            id: "project-synthetic",
            rootPath: "projects/synthetic",
            available: true,
            explicit: true,
            workspaceId: null,
          },
        })}
      />,
    );

    const section = screen
      .getByRole("heading", { name: "Code tooling" })
      .closest("section");
    expect(section).not.toBeNull();
    expect(within(section!).getByText("Unavailable")).toBeInTheDocument();
    expect(within(section!).getAllByText("Disabled")).toHaveLength(2);
    expect(
      within(section!).getByText(/review and enable plugins individually/i),
    ).toBeInTheDocument();
  });

  it("reports candidate lifecycle detail without adding bundle actions", () => {
    const failed = plugin({
      status: "failed",
      error: "Synthetic activation failure",
    });
    const enabled = plugin({
      catalog: {
        ...catalog,
        manifest: {
          ...catalog.manifest,
          id: "denote.synthetic-enabled",
          name: "Synthetic enabled plugin",
        },
      },
      status: "enabled",
      enabled: true,
    });
    const update = plugin({
      catalog: {
        ...catalog,
        manifest: {
          ...catalog.manifest,
          id: "denote.synthetic-update",
          name: "Synthetic update plugin",
        },
      },
      status: "update-available",
    });
    const incompatible = plugin({
      catalog: {
        ...catalog,
        manifest: {
          ...catalog.manifest,
          id: "denote.synthetic-incompatible",
          name: "Synthetic incompatible plugin",
        },
      },
      status: "incompatible",
      error: "Requires a newer Denote version",
    });
    const bundle: PluginBundle = {
      id: "code-tooling",
      name: "Code tooling",
      categories: ["code"],
      roles: [
        {
          id: "linter",
          name: "Linter",
          candidatePluginIds: [
            "denote.reference",
            "denote.synthetic-update",
            "denote.synthetic-incompatible",
          ],
        },
        {
          id: "compiler",
          name: "Compiler",
          candidatePluginIds: ["denote.synthetic-enabled"],
        },
      ],
    };
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [failed, update, incompatible, enabled],
          bundles: [bundle],
          activeProject: {
            id: "project-synthetic",
            rootPath: "",
            available: true,
            explicit: true,
            workspaceId: null,
          },
        })}
      />,
    );

    const section = screen
      .getByRole("heading", { name: "Code tooling" })
      .closest("section");
    expect(section).not.toBeNull();
    expect(
      within(section!).getByText("Failed — Synthetic activation failure"),
    ).toBeInTheDocument();
    expect(within(section!).getByText("Update available")).toBeInTheDocument();
    expect(
      within(section!).getByText(
        "Incompatible — Requires a newer Denote version",
      ),
    ).toBeInTheDocument();
    expect(within(section!).getAllByText("Enabled")).toHaveLength(2);
    expect(
      within(section!).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Enable" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Review and update" }),
    ).toBeInTheDocument();
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

  it("keeps credential cleanup available after permission removal", () => {
    const withoutSecureStorage = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        permissions: [{ capability: "commands" } as const],
      },
    };
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [
            plugin({
              catalog: withoutSecureStorage,
              hasCredentials: true,
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Delete credentials" }),
    ).toBeInTheDocument();
  });

  it("labels catalog changes as updates requiring review", () => {
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [
            plugin({
              status: "update-available",
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Review and update" }),
    ).toBeInTheDocument();
  });

  it("resets and imports declarative plugin settings", async () => {
    const user = userEvent.setup();
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);
    const onImportSettings = vi.fn().mockResolvedValue(undefined);
    const configurableCatalog = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        settings: {
          version: 1,
          properties: {
            enabled: {
              type: "boolean" as const,
              title: "Enabled",
              default: false,
            },
          },
        },
      },
    };
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [
            plugin({
              catalog: configurableCatalog,
              settings: { enabled: true },
            }),
          ],
          onUpdateSettings,
          onImportSettings,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reset settings" }),
    );
    expect(onUpdateSettings).toHaveBeenCalledWith("denote.reference", {
      enabled: false,
    });

    await user.click(screen.getByText("Import or export settings JSON"));
    const json = screen.getByRole("textbox", {
      name: "Reference plugin settings JSON",
    });
    fireEvent.change(json, {
      target: {
        value: '{"schemaVersion":1,"settings":{"enabled":true}}',
      },
    });
    await user.click(screen.getByRole("button", { name: "Import JSON" }));
    expect(onImportSettings).toHaveBeenCalledWith(
      "denote.reference",
      1,
      { enabled: true },
    );
  });

  it("masks sensitive string settings", () => {
    const configurableCatalog = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        settings: {
          version: 1,
          properties: {
            signingKey: {
              type: "string" as const,
              title: "GPG signing key",
              default: "",
              sensitive: true,
            },
          },
        },
      },
    };
    render(
      <PluginSettingsPanel
        {...props({
          plugins: [
            plugin({
              catalog: configurableCatalog,
              settings: { signingKey: "ABCDEF1234567890" },
            }),
          ],
        })}
      />,
    );

    expect(screen.getByLabelText("GPG signing key")).toHaveAttribute(
      "type",
      "password",
    );
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
