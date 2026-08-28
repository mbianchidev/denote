import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EditorTab } from "../types";
import { moveTab, Tabs } from "./Tabs";

const tabs: EditorTab[] = [
  {
    path: "one.md",
    title: "one.md",
    kind: "markdown",
    content: "",
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    rawEditing: false,
    editorRevision: 0,
    editRecorded: false,
    saveState: "saved",
  },
  {
    path: "two.md",
    title: "two.md",
    kind: "markdown",
    content: "",
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    rawEditing: false,
    editorRevision: 0,
    editRecorded: false,
    saveState: "dirty",
  },
];

describe("Tabs", () => {
  it("activates and closes files through accessible controls", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        onActivate={onActivate}
        onClose={onClose}
        onReorder={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /two\.md/i }));
    await user.click(screen.getByRole("button", { name: "Close two.md" }));

    expect(onActivate).toHaveBeenCalledWith("two.md");
    expect(onClose).toHaveBeenCalledWith("two.md");
  });

  it("reorders tabs from the keyboard", () => {
    const onReorder = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={onReorder}
      />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: /one\.md/i }), {
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    });

    expect(onReorder).toHaveBeenCalledWith(["two.md", "one.md"]);
  });

  it("moves a dragged tab to the target position", () => {
    expect(moveTab(tabs, "one.md", "two.md")).toEqual([
      "two.md",
      "one.md",
    ]);
  });
});
