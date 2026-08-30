import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaneResizer } from "./PaneResizer";

describe("PaneResizer", () => {
  it("exposes the split ratio through separator semantics", () => {
    render(
      <PaneResizer
        label="Resize panes horizontally (1)"
        orientation="vertical"
        value={0.62}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize panes horizontally (1)",
    });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "62");
    expect(separator).toHaveAttribute("tabindex", "0");
  });

  it("resizes with the arrow keys and commits each step", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <PaneResizer
        label="Resize panes horizontally (1)"
        orientation="vertical"
        value={0.5}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    );

    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(separator, { key: "Home" });

    expect(onResize.mock.calls.map(([delta]) => delta)).toEqual([
      0.02, -0.08, 0,
    ]);
    expect(onResizeEnd).toHaveBeenCalledTimes(3);
  });

  it("uses vertical arrows for horizontal separators", () => {
    const onResize = vi.fn();
    render(
      <PaneResizer
        label="Resize panes vertically (1)"
        orientation="horizontal"
        value={0.5}
        onResize={onResize}
        onResizeEnd={vi.fn()}
      />,
    );

    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });

    expect(onResize.mock.calls).toEqual([[0.02]]);
  });

  it("ignores keyboard and pointer input while the workspace is busy", () => {
    const onResize = vi.fn();
    render(
      <PaneResizer
        label="Resize panes horizontally (1)"
        orientation="vertical"
        value={0.5}
        disabled
        onResize={onResize}
        onResizeEnd={vi.fn()}
      />,
    );

    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("converts pointer movement into a ratio of the pane grid", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <div>
        <PaneResizer
          label="Resize panes horizontally (1)"
          orientation="vertical"
          value={0.5}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      </div>,
    );

    const separator = screen.getByRole("separator");
    const grid = separator.parentElement as HTMLElement;
    grid.getBoundingClientRect = () =>
      ({ width: 400, height: 200 }) as DOMRect;

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 240 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 240 });

    expect(onResize).toHaveBeenCalledWith(0.1);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });
});
