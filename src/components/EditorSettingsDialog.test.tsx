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
        onChange={onChange}
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
});
