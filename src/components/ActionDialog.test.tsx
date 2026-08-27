import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionDialog } from "./ActionDialog";

describe("ActionDialog", () => {
  it("submits text without relying on browser prompt support", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ActionDialog
        open
        mode="text"
        title="Create note"
        message="Choose a filename."
        initialValue="Untitled.md"
        confirmLabel="Create"
        dangerous={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Create note" });
    await user.clear(input);
    await user.type(input, "Plan.md");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onConfirm).toHaveBeenCalledWith("Plan.md");
  });
});
