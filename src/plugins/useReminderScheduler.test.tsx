import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginReminderModel,
  PluginReminderMutationRequest,
} from "@denote/plugin-sdk";
import type { PluginReminderContribution } from "./workerRuntime";
import { useReminderScheduler } from "./useReminderScheduler";

const provider: PluginReminderContribution = {
  pluginId: "denote.reminders",
  id: "denote.reminders.main",
  title: "Reminders",
  defaultSnoozeMinutes: 15,
};

const now = Date.parse("2026-09-28T19:00:00Z");
const nowValue = () => now;

function model(status: "scheduled" | "delivering" | "notified" | "failed"): PluginReminderModel {
  return {
    reminders: [
      {
        id: "synthetic-reminder",
        title: "Synthetic reminder",
        target: {
          kind: "note",
          path: "Synthetic.md",
          noteTitle: "Synthetic",
          line: null,
        },
        schedule: {
          kind: "instant",
          dueAt: now - 60_000,
          timeZone: "UTC",
        },
        dueAt: now - 60_000,
        status,
        createdAt: now - 120_000,
        updatedAt: now,
        attemptCount: status === "scheduled" ? 0 : 1,
        deliveringAt: status === "delivering" ? now : null,
        notifiedAt: status === "notified" ? now : null,
        lastError: status === "failed" ? "Synthetic failure" : null,
      },
    ],
    truncated: false,
    notices: [],
  };
}

describe("useReminderScheduler", () => {
  it("delivers overdue reminders and records the accepted notification request", async () => {
    const queryReminders = vi.fn(async () => model("scheduled"));
    const mutateReminders = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        request: PluginReminderMutationRequest,
      ) =>
        request.mutation.type === "delivery-started"
          ? model("delivering")
          : model("notified"),
    );
    const notify = vi.fn(async () => {});
    const reportError = vi.fn();

    const { unmount } = renderHook(() =>
      useReminderScheduler({
        providers: [provider],
        workspaceId: "synthetic-scope",
        queryReminders,
        mutateReminders,
        reportError,
        notify,
        now: nowValue,
      }),
    );

    await waitFor(() =>
      expect(mutateReminders).toHaveBeenCalledWith(
        provider.pluginId,
        provider.id,
        expect.objectContaining({
          mutation: expect.objectContaining({
            type: "delivery-succeeded",
          }),
        }),
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      provider.pluginId,
      "Synthetic reminder",
      expect.stringContaining("Open Denote"),
    );
    expect(reportError).not.toHaveBeenCalled();
    unmount();
  });

  it("persists a retryable failure when native notification dispatch rejects", async () => {
    const queryReminders = vi.fn(async () => model("scheduled"));
    const mutateReminders = vi.fn(
      async (
        _pluginId: string,
        _providerId: string,
        request: PluginReminderMutationRequest,
      ) => {
        if (request.mutation.type === "delivery-started") {
          return model("delivering");
        }
        return request.mutation.type === "delivery-failed"
          ? model("failed")
          : model("notified");
      },
    );
    const notify = vi.fn(async () => {
      throw new Error("Synthetic notification failure");
    });

    renderHook(() =>
      useReminderScheduler({
        providers: [provider],
        workspaceId: "synthetic-scope",
        queryReminders,
        mutateReminders,
        reportError: vi.fn(),
        notify,
        now: nowValue,
      }),
    );

    await waitFor(() =>
      expect(mutateReminders).toHaveBeenCalledWith(
        provider.pluginId,
        provider.id,
        expect.objectContaining({
          mutation: expect.objectContaining({
            type: "delivery-failed",
            error: "Synthetic notification failure",
          }),
        }),
      ),
    );
  });
});
