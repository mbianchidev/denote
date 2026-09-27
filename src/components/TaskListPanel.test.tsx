import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskListPanel } from "./TaskListPanel";

const provider = {
  pluginId: "denote.task-lists",
  id: "denote.task-lists.tasks",
  title: "Advanced task lists",
};
const snapshot = {
  workspaceKey: "vault:1",
  documents: [
    {
      path: "Plan.md",
      title: "Plan",
      source: "# Release\n- [ ] Ship #work due:2026-10-01",
    },
  ],
  skippedCount: 0,
  truncated: false,
};
const task = {
  id: "Plan.md:2:1",
  path: "Plan.md",
  noteTitle: "Plan",
  line: 2,
  text: "Ship #work due:2026-10-01",
  checked: false,
  headingPath: ["Release"],
  tags: ["work"],
  dueDate: "2026-10-01",
  locator: {
    path: "Plan.md",
    sourceLine: "- [ ] Ship #work due:2026-10-01",
    headingPath: ["Release"],
    occurrence: 1,
    matchCount: 1,
    checked: false,
  },
};

describe("TaskListPanel", () => {
  it("filters and toggles tasks with native keyboard controls", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const queryTaskList = vi.fn().mockResolvedValue({
      tasks: [task],
      totalTasks: 1,
      matchingTasks: 1,
      availableTags: ["work"],
      truncated: false,
      notices: [],
    });
    render(
      <TaskListPanel
        provider={provider}
        snapshot={snapshot}
        indexTaskList={vi.fn().mockResolvedValue(undefined)}
        queryTaskList={queryTaskList}
        onToggle={onToggle}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        onError={vi.fn()}
      />,
    );

    const checkbox = await screen.findByRole("checkbox", {
      name: /complete ship/i,
    });
    checkbox.focus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledWith(task, true);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveFocus(),
    );
    expect(screen.getByText(/no tasks match/i)).toBeInTheDocument();
  });

  it("keeps the task and reports a failed toggle", async () => {
    const user = userEvent.setup();
    const error = new Error("The task changed. Refresh and try again.");
    const onError = vi.fn();
    render(
      <TaskListPanel
        provider={provider}
        snapshot={snapshot}
        indexTaskList={vi.fn().mockResolvedValue(undefined)}
        queryTaskList={vi.fn().mockResolvedValue({
          tasks: [task],
          totalTasks: 1,
          matchingTasks: 1,
          availableTags: ["work"],
          truncated: false,
          notices: [],
        })}
        onToggle={vi.fn().mockRejectedValue(error)}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        onError={onError}
      />,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: /complete ship/i }),
    );
    expect(onError).toHaveBeenCalledWith(error);
    expect(screen.getByRole("checkbox", { name: /complete ship/i })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(/task changed/i);
  });
});
