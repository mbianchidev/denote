import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutlineResizer } from "./OutlineResizer";

describe("OutlineResizer", () => {
  it("supports keyboard resizing and reset", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <OutlineResizer
        width={280}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize document outline",
    });

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(292);
    expect(onCommit).toHaveBeenCalledWith(292);

    fireEvent.keyDown(separator, { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(280);
  });

  it("reverses pointer movement because the outline is right-aligned", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <OutlineResizer
        width={280}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize document outline",
    }) as HTMLDivElement;
    separator.setPointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn(() => false);

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 500,
      pointerId: 1,
    });
    fireEvent.pointerMove(separator, { clientX: 460, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 460, pointerId: 1 });

    expect(onChange).toHaveBeenCalledWith(320);
    expect(onCommit).toHaveBeenCalledWith(320);
  });
});
