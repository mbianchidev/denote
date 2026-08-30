import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaneControls } from "./PaneControls";

describe("PaneControls", () => {
  it("splits the editor through an accessible button", async () => {
    const user = userEvent.setup();
    const onAddPane = vi.fn();
    render(
      <PaneControls
        layout="single"
        paneCount={1}
        disabled={false}
        splitShortcut="Ctrl+\\"
        onLayoutChange={vi.fn()}
        onAddPane={onAddPane}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Split editor into a new pane" }),
    );

    expect(onAddPane).toHaveBeenCalledTimes(1);
  });

  it("stops offering new panes at the four pane limit", () => {
    render(
      <PaneControls
        layout="grid"
        paneCount={4}
        disabled={false}
        splitShortcut="Ctrl+\\"
        onLayoutChange={vi.fn()}
        onAddPane={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Split editor into a new pane" }),
    ).toBeDisabled();
  });

  it("offers every three pane arrangement and reports the chosen layout", async () => {
    const user = userEvent.setup();
    const onLayoutChange = vi.fn();
    render(
      <PaneControls
        layout="horizontal"
        paneCount={3}
        disabled={false}
        splitShortcut="Ctrl+\\"
        onLayoutChange={onLayoutChange}
        onAddPane={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Pane layout" });
    expect(
      [...select.querySelectorAll("option")].map((option) => option.value),
    ).toEqual([
      "horizontal",
      "vertical",
      "left-stack",
      "right-stack",
      "top-stack",
      "bottom-stack",
    ]);

    await user.selectOptions(select, "right-stack");

    expect(onLayoutChange).toHaveBeenCalledWith("right-stack");
  });

  it("disables the layout picker when only one layout fits", () => {
    render(
      <PaneControls
        layout="single"
        paneCount={1}
        disabled={false}
        splitShortcut="Ctrl+\\"
        onLayoutChange={vi.fn()}
        onAddPane={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Pane layout" })).toBeDisabled();
  });
});
