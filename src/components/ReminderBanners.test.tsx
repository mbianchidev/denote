import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReminderBump } from "../plugins/useReminderScheduler";
import { ReminderBanners } from "./ReminderBanners";

function bump(id: string, title: string): ReminderBump {
  return {
    id,
    provider: {
      pluginId: "denote.reminders",
      id: "denote.reminders.main",
      title: "Reminders",
      defaultSnoozeMinutes: 15,
    },
    reminder: {
      id,
      title,
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
      recurrence: null,
      dueAt: Date.parse("2026-10-01T09:00:00Z"),
      snoozedUntil: null,
      snoozeTimeZone: null,
      status: "notified",
      createdAt: Date.parse("2026-09-30T09:00:00Z"),
      updatedAt: Date.parse("2026-10-01T09:00:00Z"),
      attemptCount: 1,
      deliveringAt: null,
      notifiedAt: Date.parse("2026-10-01T09:00:00Z"),
      lastError: null,
    },
  };
}

describe("ReminderBanners", () => {
  it("announces due reminders and exposes native buttons", async () => {
    const user = userEvent.setup();
    const first = bump("one", "First reminder");
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ReminderBanners
        bumps={[first]}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "First reminder is due.",
    );
    await user.click(
      screen.getByRole("button", { name: "Open reminders" }),
    );
    expect(onOpen).toHaveBeenCalledWith(first);
    await user.click(
      screen.getByRole("button", {
        name: "Dismiss banner for First reminder",
      }),
    );
    expect(onDismiss).toHaveBeenCalledWith("one");
  });

  it("bounds the visible banner stack", () => {
    render(
      <ReminderBanners
        bumps={[
          bump("one", "One"),
          bump("two", "Two"),
          bump("three", "Three"),
          bump("four", "Four"),
        ]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("1 more due reminder.")).toBeInTheDocument();
  });
});
