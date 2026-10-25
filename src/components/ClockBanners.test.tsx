import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyClockModel } from "@denote/plugin-sdk";
import { ClockBanners } from "./ClockBanners";

describe("clock alerts", () => {
  it("keeps dismiss, snooze, and stop-sound actions available while a vault is locked", async () => {
    const user = userEvent.setup();
    const provider = { pluginId: "denote.synthetic", id: "denote.synthetic.clocks", title: "Clocks" };
    const model = emptyClockModel();
    const controller = {
      stateFor: () => ({ model, loading: false, error: null, sampledAt: 0, sample: null, attemptedAt: 0 }),
      refresh: vi.fn().mockResolvedValue(model), mutate: vi.fn().mockResolvedValue(model),
      alerts: [{ provider, kind: "alarm" as const, id: "alarm", occurrence: 3, title: "Synthetic check", sound: true, error: null }],
      soundReady: true, soundError: null, enableSound: vi.fn().mockResolvedValue(true), silence: vi.fn(),
    };
    render(<ClockBanners controller={controller} canOpen={false} onOpen={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open clocks" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Stop sound" }));
    expect(controller.silence).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Snooze 5 min" }));
    expect(controller.mutate).toHaveBeenCalledWith(provider, { type: "alarm-snooze", id: "alarm", occurrence: 3 });
    await user.click(screen.getByRole("button", { name: "Dismiss alarm Synthetic check" }));
    expect(controller.mutate).toHaveBeenCalledWith(provider, { type: "alarm-dismiss", id: "alarm", occurrence: 3 });
  });
});
