import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimeTrackingModel, PluginTimeTrackingSession } from "@denote/plugin-sdk";
import { TimeTrackingPanel } from "./TimeTrackingPanel";

const provider = { pluginId: "denote.synthetic", id: "denote.synthetic.timer", title: "Time tracking" };
const start = new Date(2026, 4, 4, 9).getTime();
const session: PluginTimeTrackingSession = {
  id: "session-1", path: "project/Plan.md", tags: ["work"], project: null,
  startedAt: start, endedAt: start + 600_000, elapsedMs: 300_000,
  status: "stopped", description: "Synthetic work", revision: 0, history: [],
  recoveryNotice: null, segments: [{ startedAt: start, elapsedMs: 300_000 }],
};

function props(sessions: PluginTimeTrackingSession[] = []) {
  const model: PluginTimeTrackingModel = {
    sessions, activeSessionId: sessions.find((value) => value.status !== "stopped")?.id ?? null,
    activeElsewhere: false, notices: [],
  };
  return {
    provider, target: { path: "project/Current.md", tags: ["work"], project: null },
    controller: {
      stateFor: () => ({ model, sampledAt: performance.now(), loading: false, error: null }),
      mutate: vi.fn().mockResolvedValue(model),
      refresh: vi.fn().mockResolvedValue(model),
    },
    encrypted: false, onOpenFile: vi.fn().mockResolvedValue(undefined),
    onExport: vi.fn().mockResolvedValue(true), onError: vi.fn(),
  };
}

describe("time-tracking panel", () => {
  it("starts from the active note and exposes pause, resume, and stop as explicit actions", async () => {
    const user = userEvent.setup();
    const options = props();
    const { rerender } = render(<TimeTrackingPanel {...options} />);
    await user.type(screen.getByLabelText("Description"), "Invented task");
    await user.click(screen.getByRole("button", { name: "Start timer" }));
    expect(options.controller.mutate).toHaveBeenCalledWith(provider, {
      type: "start", id: expect.any(String), target: options.target, description: "Invented task",
    });
    const active = { ...session, status: "running" as const, endedAt: null };
    const running = props([active]);
    rerender(<TimeTrackingPanel {...running} />);
    await user.click(screen.getByRole("button", { name: "Pause timer" }));
    expect(running.controller.mutate).toHaveBeenCalledWith(provider, { type: "pause", id: session.id });
    const paused = props([{ ...active, status: "paused" }]);
    rerender(<TimeTrackingPanel {...paused} />);
    await user.click(screen.getByRole("button", { name: "Resume timer" }));
    await user.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(paused.controller.mutate).toHaveBeenCalledWith(provider, { type: "resume", id: session.id });
    expect(paused.controller.mutate).toHaveBeenCalledWith(provider, { type: "stop", id: session.id });
  });

  it("requires an audit reason before saving a versioned correction", async () => {
    const user = userEvent.setup();
    const options = props([session]);
    render(<TimeTrackingPanel {...options} />);
    await user.click(screen.getByRole("button", { name: "Correct session" }));
    const minutes = screen.getByLabelText("Elapsed minutes");
    await user.clear(minutes);
    await user.type(minutes, "2");
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    await user.type(screen.getByLabelText("Reason for correction"), "Correct an invented duration");
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(options.controller.mutate).toHaveBeenCalledWith(provider, {
      type: "correct", id: session.id, expectedRevision: 0, reason: "Correct an invented duration",
      values: {
        startedAt: session.startedAt, endedAt: session.endedAt, elapsedMs: 120_000,
        description: session.description, tags: session.tags,
      },
    });
  });

  it("refreshes before exporting all local sessions and explains encrypted-vault metadata", async () => {
    const user = userEvent.setup();
    const options = props([session]);
    render(<TimeTrackingPanel {...options} encrypted />);
    expect(screen.getByText(/outside vault encryption/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() => expect(options.onExport).toHaveBeenCalled());
    expect(options.controller.refresh).toHaveBeenCalledWith(provider);
    expect(JSON.parse(options.onExport.mock.calls[0][1])).toMatchObject({
      schemaVersion: 1, sessions: [session],
    });
  });

  it("does not start without a note and reports rejected operations visibly", async () => {
    const user = userEvent.setup();
    const options = props();
    const { rerender } = render(<TimeTrackingPanel {...options} target={null} />);
    expect(screen.getByRole("button", { name: "Start timer" })).toBeDisabled();
    options.controller.mutate.mockRejectedValue(new Error("Synthetic write failed"));
    rerender(<TimeTrackingPanel {...options} />);
    await user.click(screen.getByRole("button", { name: "Start timer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic write failed");
    expect(options.onError).toHaveBeenCalled();
  });

  it("recomputes civil summary boundaries when the system time zone changes", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const startedAt = Date.parse("2026-05-05T00:00:00Z");
      const elapsedMs = 3_600_000;
      const options = props([{
        ...session, startedAt, endedAt: startedAt + elapsedMs, elapsedMs,
        segments: [{ startedAt, elapsedMs }],
      }]);
      const rendered = render(<TimeTrackingPanel {...options} />);
      fireEvent.change(screen.getByLabelText("Summary date"), { target: { value: "2026-05-04" } });
      const summary = within(screen.getByRole("region", { name: "Time summaries" }));
      expect(summary.queryByText(session.path)).not.toBeInTheDocument();
      process.env.TZ = "America/New_York";
      rendered.rerender(<TimeTrackingPanel {...options} />);
      expect(summary.getByText(session.path)).toBeInTheDocument();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
