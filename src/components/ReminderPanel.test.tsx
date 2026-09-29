import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginReminderModel,
  PluginReminderRecord,
} from "@denote/plugin-sdk";
import type { PluginReminderContribution } from "../plugins/workerRuntime";
import type { ReminderSchedulerController } from "../plugins/useReminderScheduler";
import { ReminderPanel } from "./ReminderPanel";

const provider: PluginReminderContribution = {
  pluginId: "denote.reminders",
  id: "denote.reminders.main",
  title: "Reminders",
  defaultSnoozeMinutes: 15,
};

const emptyModel: PluginReminderModel = {
  reminders: [],
  truncated: false,
  notices: [],
};

function scheduler(
  reminders: PluginReminderRecord[] = [],
): ReminderSchedulerController & {
  mutate: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  return {
    stateFor: () => ({
      model: { ...emptyModel, reminders },
      loading: false,
      error: null,
    }),
    dueCountFor: () => reminders.length,
    mutate: vi.fn(async () => emptyModel),
    retry: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  };
}

describe("ReminderPanel", () => {
  it("creates a wall-clock reminder linked to a parsed task", async () => {
    const user = userEvent.setup();
    const controller = scheduler();
    const parseTargets = vi.fn(async () => ({
      targets: [
        {
          id: "task:3:1",
          kind: "task" as const,
          path: "Synthetic.md",
          noteTitle: "Synthetic",
          line: 3,
          label: "Task: Review the synthetic plan",
        },
      ],
      truncated: false,
      notices: [],
    }));

    render(
      <ReminderPanel
        provider={provider}
        document={{
          path: "Synthetic.md",
          title: "Synthetic",
          source: "# Plan\n\n- [ ] Review the synthetic plan",
        }}
        parseTargets={parseTargets}
        scheduler={controller}
        encrypted={false}
        onOpenFile={vi.fn(async () => {})}
        onError={vi.fn()}
      />,
    );

    await screen.findByRole("option", {
      name: "Task: Review the synthetic plan",
    });
    await user.clear(screen.getByLabelText("Reminder name"));
    await user.type(screen.getByLabelText("Reminder name"), "Review plan");
    const create = screen.getByRole("button", { name: "Create reminder" });
    expect(create).toHaveClass("primary-button");
    await user.click(create);

    await waitFor(() =>
      expect(controller.mutate).toHaveBeenCalledWith(
        provider,
        expect.objectContaining({
          type: "create",
          title: "Review plan",
          target: expect.objectContaining({
            kind: "task",
            line: 3,
          }),
          schedule: expect.objectContaining({
            kind: "wall-clock",
          }),
        }),
      ),
    );
  });

  it("offers open, snooze, retry, and dismiss actions for a failed reminder", async () => {
    const user = userEvent.setup();
    const reminder: PluginReminderRecord = {
      id: "failed-reminder",
      title: "Review plan",
      target: {
        kind: "heading",
        path: "Synthetic.md",
        noteTitle: "Synthetic",
        line: 2,
      },
      schedule: {
        kind: "instant",
        dueAt: Date.now() - 60_000,
        timeZone: "UTC",
      },
      dueAt: Date.now() - 60_000,
      status: "failed",
      createdAt: Date.now() - 120_000,
      updatedAt: Date.now() - 60_000,
      attemptCount: 1,
      deliveringAt: null,
      notifiedAt: null,
      lastError: "Synthetic notification failure",
    };
    const controller = scheduler([reminder]);
    const onOpenFile = vi.fn(async () => {});

    render(
      <ReminderPanel
        provider={provider}
        document={null}
        parseTargets={vi.fn()}
        scheduler={controller}
        encrypted={true}
        onOpenFile={onOpenFile}
        onError={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open note" }));
    expect(onOpenFile).toHaveBeenCalledWith("Synthetic.md");

    await user.click(
      screen.getByRole("button", { name: "Retry notification" }),
    );
    expect(controller.retry).toHaveBeenCalledWith(provider, reminder);

    await user.click(screen.getByRole("button", { name: "Snooze 15m" }));
    expect(controller.mutate).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        type: "snooze",
        id: reminder.id,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(controller.mutate).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        type: "dismiss",
        id: reminder.id,
      }),
    );
  });
});
