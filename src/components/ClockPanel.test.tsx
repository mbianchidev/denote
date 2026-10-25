import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyClockModel } from "@denote/plugin-sdk";
import { ClockPanel } from "./ClockPanel";

function props() {
  const model = emptyClockModel();
  return {
    provider: { pluginId: "denote.synthetic", id: "denote.synthetic.clocks", title: "Time tracking" },
    controller: {
      stateFor: () => ({ model, loading: false, error: null, sampledAt: performance.now(), sample: null, attemptedAt: 0 }),
      refresh: vi.fn().mockResolvedValue(model),
      mutate: vi.fn().mockResolvedValue(model),
      alerts: [], soundReady: false, soundError: null,
      enableSound: vi.fn().mockResolvedValue(true), silence: vi.fn(),
    },
    noteTracking: <p>Synthetic note tracking remains available.</p>,
    confirmAction: vi.fn().mockResolvedValue(true),
    onError: vi.fn(),
  };
}

describe("clock modes", () => {
  it("offers a standalone timer without an open note and preserves the Notes mode", async () => {
    const user = userEvent.setup();
    const options = props();
    render(<ClockPanel {...options} />);
    await user.click(screen.getByRole("button", { name: "Start timer" }));
    expect(options.controller.mutate).toHaveBeenCalledWith(options.provider, { type: "stopwatch-start" });
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("Synthetic note tracking remains available.")).toBeInTheDocument();
  });

  it("creates a named countdown with exact hour/minute/second duration", async () => {
    const user = userEvent.setup();
    const options = props();
    render(<ClockPanel {...options} />);
    await user.click(screen.getByRole("button", { name: "Countdowns" }));
    await user.clear(screen.getByLabelText("Countdown name"));
    await user.type(screen.getByLabelText("Countdown name"), "Field break");
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Seconds"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "Start countdown" }));
    expect(options.controller.mutate).toHaveBeenCalledWith(options.provider, {
      type: "countdown-create", id: expect.any(String), title: "Field break", durationMs: 65_000, sound: true,
    });
    expect(options.controller.enableSound).toHaveBeenCalled();
  });

  it("sets a civil alarm with explicit date, time, recurrence, and sound", async () => {
    const user = userEvent.setup();
    const options = props();
    render(<ClockPanel {...options} />);
    await user.click(screen.getByRole("button", { name: "Alarm" }));
    fireEvent.change(screen.getByLabelText("Alarm date"), { target: { value: "2026-12-04" } });
    fireEvent.change(screen.getByLabelText("Alarm time"), { target: { value: "09:30" } });
    await user.click(screen.getByLabelText("Repeat daily"));
    await user.click(screen.getByRole("button", { name: "Set alarm" }));
    expect(options.controller.mutate).toHaveBeenCalledWith(options.provider, {
      type: "alarm-create", id: expect.any(String), title: "Alarm", localDateTime: "2026-12-04T09:30",
      timeZone: expect.any(String), repeatDaily: true, sound: true,
    });
  });

  it("lets keyboard users reach and activate every mode", async () => {
    const user = userEvent.setup();
    render(<ClockPanel {...props()} />);
    screen.getByRole("button", { name: "Timer" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Countdowns" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByLabelText("Countdown name")).toBeInTheDocument();
  });
});
