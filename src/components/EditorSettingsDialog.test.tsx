import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { EditorSettingsDialog } from "./EditorSettingsDialog";

describe("EditorSettingsDialog", () => {
  it("applies display settings immediately", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EditorSettingsDialog
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        onChange={onChange}
        onRestoreTabsChange={vi.fn()}
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
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        onChange={vi.fn()}
        onRestoreTabsChange={onRestoreTabsChange}
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
        open
        disabled={false}
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        onChange={onChange}
        onRestoreTabsChange={vi.fn()}
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

  it("blocks preference changes while the workspace is busy", async () => {
    const user = userEvent.setup();
    const onRestoreTabsChange = vi.fn();
    render(
      <EditorSettingsDialog
        open
        disabled
        settings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        restoreTabs
        onChange={vi.fn()}
        onRestoreTabsChange={onRestoreTabsChange}
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
});
