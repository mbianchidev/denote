import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityRail } from "./ActivityRail";

describe("ActivityRail", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens About Denote from a named button", async () => {
    const user = userEvent.setup();
    const onAbout = vi.fn();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={null}
        activeTaskList={null}
        pluginViews={[]}
        sourceControlProviders={[]}
        noteGraphs={[]}
        taskLists={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={vi.fn()}
        onAbout={onAbout}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "About Denote" }));
    expect(onAbout).toHaveBeenCalledOnce();
  });

  it("opens a registered plugin sidebar view", async () => {
    const user = userEvent.setup();
    const onPluginViewChange = vi.fn();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={null}
        activeTaskList={null}
        pluginViews={[{ id: "denote.reference.status", title: "Plugin reference" }]}
        sourceControlProviders={[]}
        noteGraphs={[]}
        taskLists={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={onPluginViewChange}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Plugin reference" }),
    );

    expect(onPluginViewChange).toHaveBeenCalledWith(
      "denote.reference.status",
    );
  });

  it("identifies source control providers by plugin and provider id", async () => {
    const user = userEvent.setup();
    const onSourceControlProviderChange = vi.fn();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={{
          pluginId: "denote.alpha",
          providerId: "git",
        }}
        activeNoteGraph={null}
        activeTaskList={null}
        pluginViews={[]}
        sourceControlProviders={[
          {
            pluginId: "denote.alpha",
            id: "git",
            title: "Git",
            model: sourceControlModel(),
          },
          {
            pluginId: "denote.beta",
            id: "git",
            title: "Git",
            model: sourceControlModel(),
          },
        ]}
        noteGraphs={[]}
        taskLists={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={onSourceControlProviderChange}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Source control: Git (denote.alpha)",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const betaProvider = screen.getByRole("button", {
      name: "Source control: Git (denote.beta)",
    });
    betaProvider.focus();
    await user.keyboard("{Enter}");
    expect(onSourceControlProviderChange).toHaveBeenCalledWith(
      "denote.beta",
      "git",
    );
  });

  it("opens a registered note graph with a distinct rail control", async () => {
    const user = userEvent.setup();
    const onNoteGraphChange = vi.fn();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={{
          pluginId: "denote.note-graph",
          providerId: "denote.note-graph.graph",
        }}
        activeTaskList={null}
        pluginViews={[]}
        sourceControlProviders={[]}
        noteGraphs={[
          {
            pluginId: "denote.note-graph",
            id: "denote.note-graph.graph",
            title: "Note graph",
          },
        ]}
        taskLists={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={onNoteGraphChange}
        onTaskListChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    const graph = screen.getByRole("button", { name: "Note graph" });
    expect(graph).toHaveAttribute("aria-pressed", "true");
    await user.click(graph);
    expect(onNoteGraphChange).toHaveBeenCalledWith(
      "denote.note-graph",
      "denote.note-graph.graph",
    );
  });

  it("opens a registered task list with a keyboard-operable rail control", async () => {
    const user = userEvent.setup();
    const onTaskListChange = vi.fn();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={null}
        activeTaskList={{
          pluginId: "denote.task-lists",
          providerId: "denote.task-lists.tasks",
        }}
        pluginViews={[]}
        sourceControlProviders={[]}
        noteGraphs={[]}
        taskLists={[
          {
            pluginId: "denote.task-lists",
            id: "denote.task-lists.tasks",
            title: "Advanced task lists",
          },
        ]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={onTaskListChange}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    const taskList = screen.getByRole("button", {
      name: "Advanced task lists",
    });
    expect(taskList).toHaveAttribute("aria-pressed", "true");
    taskList.focus();
    await user.keyboard("{Enter}");
    expect(onTaskListChange).toHaveBeenCalledWith(
      "denote.task-lists",
      "denote.task-lists.tasks",
    );
  });

  it("announces due reminders and opens their host-rendered view", async () => {
    const user = userEvent.setup();
    const onReminderChange = vi.fn();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={null}
        activeTaskList={null}
        activeReminder={{
          pluginId: "denote.reminders",
          providerId: "denote.reminders.main",
        }}
        pluginViews={[]}
        sourceControlProviders={[]}
        noteGraphs={[]}
        taskLists={[]}
        reminders={[
          {
            pluginId: "denote.reminders",
            id: "denote.reminders.main",
            title: "Reminders",
            defaultSnoozeMinutes: 15,
          },
        ]}
        reminderDueCounts={{
          "denote.reminders\u0000denote.reminders.main": 2,
        }}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={vi.fn()}
        onReminderChange={onReminderChange}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    const reminders = screen.getByRole("button", {
      name: "Reminders, 2 need attention",
    });
    expect(reminders).toHaveAttribute("aria-pressed", "true");
    await user.click(reminders);
    expect(onReminderChange).toHaveBeenCalledWith(
      "denote.reminders",
      "denote.reminders.main",
    );
  });

  it("disambiguates providers with duplicate titles from the same plugin", () => {
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={null}
        activeTaskList={null}
        pluginViews={[]}
        sourceControlProviders={[
          {
            pluginId: "denote.git",
            id: "denote.git.primary",
            title: "Git",
            model: sourceControlModel(),
          },
          {
            pluginId: "denote.git",
            id: "denote.git.secondary",
            title: "Git",
            model: sourceControlModel(),
          },
        ]}
        noteGraphs={[]}
        taskLists={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Source control: Git (denote.git.primary)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Source control: Git (denote.git.secondary)",
      }),
    ).toBeInTheDocument();
  });

  it("reorders, groups, hides, and restores plugin entries", async () => {
    const user = userEvent.setup();
    render(
      <ActivityRail
        calendars={[]}
        activeCalendar={null}
        onCalendarChange={vi.fn()}
        activeView="files"
        activePluginView={null}
        activeSourceControlProvider={null}
        activeNoteGraph={null}
        activeTaskList={null}
        pluginViews={[
          { id: "denote.alpha.view", title: "Alpha" },
          { id: "denote.beta.view", title: "Beta" },
        ]}
        sourceControlProviders={[]}
        noteGraphs={[]}
        taskLists={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onSourceControlProviderChange={vi.fn()}
        onNoteGraphChange={vi.fn()}
        onTaskListChange={vi.fn()}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    fireEvent.dragStart(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.drop(screen.getByRole("button", { name: "Beta" }));
    expect(localStorage.getItem("denote.plugin-rail.v1")).toContain(
      "view:denote.alpha.view",
    );

    await user.click(screen.getByText("Organize plugins"));
    await user.type(screen.getByLabelText("Group for Alpha"), "Writing");
    expect(
      screen.getByRole("button", {
        name: "Collapse Writing plugin group",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide Alpha" }));
    expect(
      screen.queryByRole("button", { name: "Alpha" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByText("Hidden plugins (1)"));
    await user.click(screen.getByRole("button", { name: "Show Alpha" }));
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
  });
});

function sourceControlModel() {
  return {
    selectedTab: "changes" as const,
    selectedView: { kind: "repository" as const },
    repository: {
      repositoryId: "synthetic-repository",
      label: "Synthetic repository",
      initialized: true,
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      latestCommit: null,
      busy: false,
    },
    resourceGroups: [],
    branches: [],
    remotes: [],
    history: [],
    historyPage: {
      pageIndex: 0,
      pageSize: 20,
      hasPrevious: false,
      hasNext: false,
      loading: false,
      error: null,
    },
    commitDetail: null,
    diffFiles: [],
    diffSource: null,
    conflicts: [],
    conflictDetail: null,
    operationProgress: null,
    operationPlan: null,
    recovery: { state: "idle" as const },
    remoteAccess: {
      authMode: "public" as const,
      cloneAvailable: true,
      githubAvailable: false,
      repositories: [],
      cleanup: null,
      review: null,
    },
    pendingBranchSwitch: null,
  };
}
