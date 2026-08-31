import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { EditorSettingsDialog } from "./EditorSettingsDialog";

const pluginProps = {
  plugins: [],
  pluginsLoading: false,
  busyPluginIds: new Set<string>(),
  onEnablePlugin: vi.fn(),
  onDisablePlugin: vi.fn(),
  onDisableAllPlugins: vi.fn(),
  onClearPluginData: vi.fn(),
  onClearPluginCredentials: vi.fn(),
  onUpdatePluginSettings: vi.fn(),
  onImportPluginSettings: vi.fn(),
  onPluginError: vi.fn(),
};

describe("EditorSettingsDialog", () => {
  it("applies display settings immediately", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={[]}
        allowAllExternalDomains={false}
        onChange={onChange}
        onRestoreTabsChange={vi.fn()}
        onRemoveExternalDomain={vi.fn()}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /show line numbers/i }),
    );

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      showLineNumbers: true,
    });
  });

  it("changes the current vault tab-restore preference", async () => {
    const user = userEvent.setup();
    const onRestoreTabsChange = vi.fn();
    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={[]}
        allowAllExternalDomains={false}
        onChange={vi.fn()}
        onRestoreTabsChange={onRestoreTabsChange}
        onRemoveExternalDomain={vi.fn()}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /reopen tabs from the last session/i }),
    );

    expect(onRestoreTabsChange).toHaveBeenCalledWith(false);
  });

  it("changes the persistent editor font size", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={[]}
        allowAllExternalDomains={false}
        onChange={onChange}
        onRestoreTabsChange={vi.fn()}
        onRemoveExternalDomain={vi.fn()}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Increase editor font size" }),
    );

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      fontSize: 17,
    });
  });

  it("changes source indentation between two and four spaces", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={[]}
        allowAllExternalDomains={false}
        onChange={onChange}
        onRestoreTabsChange={vi.fn()}
        onRemoveExternalDomain={vi.fn()}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "2 spaces" }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
      tabSize: 2,
    });
  });

  it("blocks preference changes while the workspace is busy", async () => {
    const user = userEvent.setup();
    const onRestoreTabsChange = vi.fn();
    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={[]}
        allowAllExternalDomains={false}
        onChange={vi.fn()}
        onRestoreTabsChange={onRestoreTabsChange}
        onRemoveExternalDomain={vi.fn()}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const restore = screen.getByRole("checkbox", {
      name: /reopen tabs from the last session/i,
    });
    expect(restore).toBeDisabled();
    await user.click(restore);
    expect(onRestoreTabsChange).not.toHaveBeenCalled();
  });

  it("lists and removes allowed external domains", async () => {
    const user = userEvent.setup();
    const onRemoveExternalDomain = vi.fn();
    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={["example.com"]}
        allowAllExternalDomains={false}
        onChange={vi.fn()}
        onRestoreTabsChange={vi.fn()}
        onRemoveExternalDomain={onRemoveExternalDomain}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("example.com")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Remove external domain example.com",
      }),
    );
    expect(onRemoveExternalDomain).toHaveBeenCalledWith("example.com");
  });

  it("opens the plugin manager inside settings", async () => {
    const user = userEvent.setup();
    render(
      <EditorSettingsDialog
        {...pluginProps}
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        externalDomains={[]}
        allowAllExternalDomains={false}
        onChange={vi.fn()}
        onRestoreTabsChange={vi.fn()}
        onRemoveExternalDomain={vi.fn()}
        onClearExternalDomains={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Plugins" }));

    expect(
      screen.getByRole("heading", { name: "Plugins" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No plugins match these filters.")).toBeInTheDocument();
  });
});
