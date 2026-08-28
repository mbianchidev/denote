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
});
