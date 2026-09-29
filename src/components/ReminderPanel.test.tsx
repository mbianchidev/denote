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
    bumps: [],
    stateFor: () => ({
      model: { ...emptyModel, reminders },
      loading: false,
      error: null,
    }),
    dueCountFor: () => reminders.length,
    mutate: vi.fn(async () => emptyModel),
    retry: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    dismissBump: vi.fn(),
    clearBumpsFor: vi.fn(),
  };
}

describe("ReminderPanel", () => {
  it("creates a standalone recurring reminder without an open note", async () => {
    const user = userEvent.setup();
    const controller = scheduler();
    const parseTargets = vi.fn(async () => ({
      targets: [
        {
          id: "standalone",
          kind: "standalone" as const,
          path: null,
          noteTitle: null,
          line: null,
          label: "No note",
        },
      ],
      truncated: false,
      notices: [],
    }));

    render(
      <ReminderPanel
        provider={provider}
        document={null}
        parseTargets={parseTargets}
        scheduler={controller}
        encrypted={false}
        onOpenFile={vi.fn(async () => {})}
        onError={vi.fn()}
      />,
    );

    await screen.findByRole("option", { name: "No note" });
    const interval = screen.getByLabelText("Repeat interval");
    expect(interval).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "Every N hours" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Every N minutes" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reminder name"), "Review plan");
    await user.selectOptions(screen.getByLabelText("Repeat"), "minute");
    expect(interval).toBeEnabled();
    await user.clear(interval);
    await user.type(interval, "15");
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
            kind: "standalone",
            path: null,
          }),
          schedule: expect.objectContaining({
            kind: "wall-clock",
          }),
          recurrence: { interval: 15, unit: "minute" },
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
      recurrence: null,
      dueAt: Date.now() - 60_000,
      snoozedUntil: null,
      snoozeTimeZone: null,
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
        parseTargets={vi.fn(async () => ({
          targets: [
            {
              id: "standalone",
              kind: "standalone" as const,
              path: null,
              noteTitle: null,
              line: null,
              label: "No note",
            },
          ],
          truncated: false,
          notices: [],
        }))}
        scheduler={controller}
        encrypted={true}
        onOpenFile={onOpenFile}
        onError={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit reminder" }))
      .toBeInTheDocument();
    await user.clear(screen.getByLabelText("Reminder name"));
    await user.type(screen.getByLabelText("Reminder name"), "Updated plan");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(controller.mutate).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        type: "update",
        id: reminder.id,
        title: "Updated plan",
      }),
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

  it("advances or deletes a recurring standalone reminder", async () => {
    const user = userEvent.setup();
    const reminder: PluginReminderRecord = {
      id: "monthly-reminder",
      title: "Monthly review",
      target: {
        kind: "standalone",
        path: null,
        noteTitle: null,
        line: null,
      },
      schedule: {
        kind: "wall-clock",
        localDateTime: "2026-10-01T09:00",
        timeZone: "UTC",
      },
      recurrence: { interval: 1, unit: "month" },
      dueAt: Date.parse("2026-10-01T09:00:00Z"),
      snoozedUntil: null,
      snoozeTimeZone: null,
      status: "notified",
      createdAt: Date.parse("2026-09-01T09:00:00Z"),
      updatedAt: Date.parse("2026-10-01T09:00:00Z"),
      attemptCount: 1,
      deliveringAt: null,
      notifiedAt: Date.parse("2026-10-01T09:00:00Z"),
      lastError: null,
    };
    const controller = scheduler([reminder]);
    render(
      <ReminderPanel
        provider={provider}
        document={null}
        parseTargets={vi.fn(async () => ({
          targets: [{
            id: "standalone",
            kind: "standalone" as const,
            path: null,
            noteTitle: null,
            line: null,
            label: "No note",
          }],
          truncated: false,
          notices: [],
        }))}
        scheduler={controller}
        encrypted={false}
        onOpenFile={vi.fn(async () => {})}
        onError={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open note" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Repeats every 1 month")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Next occurrence" }),
    );
    expect(controller.mutate).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        type: "dismiss",
        id: reminder.id,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete series" }),
    );
    expect(controller.mutate).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        type: "remove",
        id: reminder.id,
      }),
    );
  });
});
