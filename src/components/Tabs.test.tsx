import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { moveTabInLayout } from "../lib/tabs";
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

  it("restores focus after moving a tab to another group", async () => {
    const user = userEvent.setup();
    const StatefulTabs = () => {
      const [current, setCurrent] = useState(tabs);
      return (
        <Tabs
          tabs={current}
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
          onMoveToGroup={(path, groupId) =>
            setCurrent((value) =>
              value.map((tab) =>
                tab.path === path ? { ...tab, groupId } : tab,
              ),
            )
          }
          onCloseMany={vi.fn()}
        />
      );
    };
    render(<StatefulTabs />);

    const tabControl = screen.getByRole("tab", { name: /one\.md/i });
    tabControl.focus();
    fireEvent.keyDown(tabControl, { key: "ContextMenu" });
    await user.click(
      await screen.findByRole("menuitem", { name: "Move to Work" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /one\.md/i })).toHaveFocus(),
    );
  });

  it("restores focus after keyboard reordering changes groups", async () => {
    const StatefulTabs = () => {
      const [current, setCurrent] = useState([
        tabs[0],
        { ...tabs[1], groupId: "work" },
      ]);
      return (
        <Tabs
          tabs={current}
          activePath="one.md"
          disabled={false}
          groups={[{ id: "work", name: "Work", collapsed: false }]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onReorder={(sourcePath, targetPath) =>
            setCurrent((value) =>
              moveTabInLayout(value, sourcePath, targetPath),
            )
          }
          onNewTab={vi.fn()}
          onToggleGroup={vi.fn()}
          onCreateGroup={vi.fn()}
          onRenameGroup={vi.fn()}
          onMoveToGroup={vi.fn()}
          onCloseMany={vi.fn()}
        />
      );
    };
    render(<StatefulTabs />);

    const tabControl = screen.getByRole("tab", { name: /one\.md/i });
    tabControl.focus();
    fireEvent.keyDown(tabControl, {
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /one\.md/i })).toHaveFocus(),
    );
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
  it("moves a tab to another pane from the tab context menu", async () => {
    const user = userEvent.setup();
    const onMoveToPane = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        groups={[]}
        label="Open files in pane 1"
        paneTargets={[{ id: "pane-2", label: "pane 2" }]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseMany={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onMoveToPane={onMoveToPane}
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "Open files in pane 1" }),
    ).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("tab", { name: /one\.md/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Move to pane 2" }),
    );

    expect(onMoveToPane).toHaveBeenCalledWith("one.md", "pane-2");
  });

  it("omits pane moves when the workspace has a single pane", async () => {
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        disabled={false}
        groups={[]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseMany={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
        onToggleGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onMoveToGroup={vi.fn()}
        onMoveToPane={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("tab", { name: /one\.md/i }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Move to pane/ }),
    ).not.toBeInTheDocument();
  });
});
