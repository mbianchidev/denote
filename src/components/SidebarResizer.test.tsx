import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarResizer } from "./SidebarResizer";

describe("SidebarResizer", () => {
  it("supports keyboard resizing and reset", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <SidebarResizer width={272} onChange={onChange} onCommit={onCommit} />,
    );
    const separator = screen.getByRole("separator", {
      name: "Resize vault sidebar",
    });

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(284);
    expect(onCommit).toHaveBeenCalledWith(284);

    fireEvent.keyDown(separator, { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(272);
  });
});
