import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagChip } from "./TagChip";

describe("TagChip", () => {
  it("searches for its tag and exposes an accessible color picker", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onColorChange = vi.fn();
    render(
      <TagChip
        tag="guide"
        color="#7aa66a"
        editable
        onActivate={onActivate}
        onColorChange={onColorChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Search for #guide" }));
    expect(onActivate).toHaveBeenCalledWith("guide");

    fireEvent.change(screen.getByLabelText("Change color for #guide"), {
      target: { value: "#336699" },
    });
    expect(onColorChange).toHaveBeenCalledWith("guide", "#336699");
  });
});
