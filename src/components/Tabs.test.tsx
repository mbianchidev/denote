import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EditorTab } from "../types";
import { Tabs } from "./Tabs";

const tabs: EditorTab[] = [
  {
    path: "one.md",
    title: "one.md",
    kind: "markdown",
    content: "",
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    placeholder: false,
    groupId: null,
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
    placeholder: false,
    groupId: null,
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
        onNewTab={vi.fn()}
        groups={[]}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={vi.fn()}
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
        onNewTab={vi.fn()}
        groups={[]}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: /one\.md/i }), {
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    });

    expect(onReorder).toHaveBeenCalledWith("one.md", "two.md");
  });

  it("reorders tabs with pointer dragging", () => {
    const onReorder = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={onReorder}
        onNewTab={vi.fn()}
        groups={[]}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={vi.fn()}
      />,
    );

    const first = screen.getByRole("tab", { name: /one\.md/i });
    const secondContainer = screen
      .getByRole("tab", { name: /two\.md/i })
      .closest(".tab");
    expect(secondContainer).not.toBeNull();
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => secondContainer),
    });

    fireEvent.pointerDown(first, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(first, { clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(first, { clientX: 200, clientY: 10, pointerId: 1 });

    expect(onReorder).toHaveBeenCalledWith("one.md", "two.md");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });

  it("creates an explicit new tab from the plus button", async () => {
    const user = userEvent.setup();
    const onNewTab = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={onNewTab}
        groups={[]}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New tab" }));

    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it("renders named groups and toggles their collapsed state", async () => {
    const user = userEvent.setup();
    const onToggleGroup = vi.fn();
    render(
      <Tabs
        tabs={tabs.map((tab) => ({ ...tab, groupId: "work" }))}
        activePath="one.md"
        disabled={false}
        groups={[{ id: "work", name: "Work", collapsed: false }]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
        onToggleGroup={onToggleGroup}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Collapse tab group Work" }),
    );

    expect(onToggleGroup).toHaveBeenCalledWith("work");
  });

  it("keeps the active tab available when its group is collapsed", () => {
    render(
      <Tabs
        tabs={tabs.map((tab) => ({ ...tab, groupId: "work" }))}
        activePath="two.md"
        disabled={false}
        groups={[{ id: "work", name: "Work", collapsed: true }]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /two\.md/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /one\.md/i }),
    ).not.toBeInTheDocument();
  });

  it("uses visual group order for close-to-the-right", async () => {
    const user = userEvent.setup();
    const onCloseMany = vi.fn();
    render(
      <Tabs
        tabs={[
          { ...tabs[0], groupId: "work" },
          { ...tabs[1], path: "outside.md", title: "outside.md" },
          { ...tabs[1], groupId: "work" },
        ]}
        activePath="one.md"
        disabled={false}
        groups={[{ id: "work", name: "Work", collapsed: false }]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={onCloseMany}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("tab", { name: /two\.md/i }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Close all to the right",
      }),
    );

    expect(onCloseMany).toHaveBeenCalledWith(["outside.md"]);
  });

  it("closes other tabs from the tab context menu", async () => {
    const user = userEvent.setup();
    const onCloseMany = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        groups={[]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onCloseMany={onCloseMany}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("tab", { name: /one\.md/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Close others" }),
    );

    expect(onCloseMany).toHaveBeenCalledWith(["two.md"]);
  });
});
