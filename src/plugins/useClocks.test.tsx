import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyClockModel, pendingClockDelivery, type PluginClockModel, type PluginClockRequest } from "@denote/plugin-sdk";
import { useClocks } from "./useClocks";

const provider = { pluginId: "denote.synthetic", id: "denote.synthetic.clocks", title: "Clocks" };
const now = Date.parse("2026-05-04T09:00:00Z");
const sampleClock = async () => ({ bootId: "synthetic", wallTimeMs: now, monotonicMs: 0 });
function ringing(): PluginClockModel {
  return {
    ...emptyClockModel(),
    countdowns: [{
      id: "break", title: "Synthetic break", durationMs: 60_000, remainingMs: 0,
      status: "ringing", sound: true, occurrence: 1, createdAt: now - 60_000, updatedAt: now,
      recoveryNotice: null, delivery: pendingClockDelivery(),
    }],
  };
}
function audio() {
  return { ready: false, enable: vi.fn().mockResolvedValue(undefined), setRinging: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
}

describe("clock host scheduling", () => {
  it("requests one notification per occurrence and keeps an actionable ringing state", async () => {
    const model = ringing();
    const request = vi.fn(async (_plugin: string, _provider: string, input: PluginClockRequest) => {
      if (input.mutation?.type === "notification-started") model.countdowns[0].delivery = { status: "sending", attempts: 1, error: null };
      if (input.mutation?.type === "notification-succeeded") model.countdowns[0].delivery.status = "sent";
      return structuredClone(model);
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const player = audio();
    const { result } = renderHook(() => useClocks({
      providers: [provider], request, notify, audio: player,
      clock: sampleClock, reportError: vi.fn(),
    }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(3));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(player.setRinging).toHaveBeenCalledWith(true);
  });

  it("withdraws ringing sound and refuses stale delivery completion after disablement", async () => {
    const model = ringing();
    const request = vi.fn(async (_plugin: string, _provider: string, input: PluginClockRequest) => {
      if (input.mutation?.type === "notification-started") model.countdowns[0].delivery.status = "sending";
      return structuredClone(model);
    });
    let finish: () => void = () => {};
    const notify = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const player = audio();
    const rendered = renderHook(({ enabled }) => useClocks({
      providers: enabled ? [provider] : [], request, notify, audio: player,
      clock: sampleClock, reportError: vi.fn(),
    }), { initialProps: { enabled: true } });
    await waitFor(() => expect(notify).toHaveBeenCalled());
    rendered.rerender({ enabled: false });
    await act(async () => { finish(); });
    expect(player.setRinging).toHaveBeenLastCalledWith(false);
    expect(request.mock.calls.some((call) => call[2].mutation?.type === "notification-succeeded")).toBe(false);
  });

  it("retains notification failures for an explicit retry, including non-Error rejections", async () => {
    const model = ringing();
    const request = vi.fn(async (_plugin: string, _provider: string, input: PluginClockRequest) => {
      if (input.mutation?.type === "notification-started") model.countdowns[0].delivery.status = "sending";
      if (input.mutation?.type === "notification-failed") {
        model.countdowns[0].delivery = { status: "failed", attempts: 1, error: input.mutation.error };
      }
      if (input.mutation?.type === "notification-succeeded") model.countdowns[0].delivery.status = "sent";
      return structuredClone(model);
    });
    const notify = vi.fn().mockRejectedValue(null);
    const { result } = renderHook(() => useClocks({
      providers: [provider], request, notify, audio: audio(), clock: sampleClock, reportError: vi.fn(),
    }));
    await waitFor(() => expect(result.current.stateFor(provider).model?.countdowns[0].delivery.status).toBe("failed"));
    expect(result.current.alerts[0].error).toBeTruthy();
  });

  it("does not spin or dispatch when the delivery checkpoint cannot be saved", async () => {
    const model = ringing();
    let starts = 0;
    const request = vi.fn(async (_plugin: string, _provider: string, input: PluginClockRequest) => {
      if (input.mutation?.type === "notification-started") {
        starts += 1;
        if (starts === 1) throw new Error("Synthetic storage failure");
        model.countdowns[0].delivery = { status: "sending", attempts: 1, error: null };
      }
      if (input.mutation?.type === "notification-succeeded") model.countdowns[0].delivery.status = "sent";
      return structuredClone(model);
    });
    const reportError = vi.fn();
    const notify = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useClocks({
      providers: [provider], request, notify, audio: audio(), clock: sampleClock, reportError,
    }));
    await waitFor(() => expect(reportError).toHaveBeenCalled());
    await act(async () => {});
    expect(starts).toBe(1);
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.stateFor(provider).error).toBe("Synthetic storage failure");
    await act(async () => { await result.current.refresh(provider); });
    await waitFor(() => expect(notify).toHaveBeenCalledOnce());
  });

  it("makes a lost dispatch acknowledgement explicitly retryable without automatically sending again", async () => {
    const model = ringing();
    let failAcknowledgement = true;
    const request = vi.fn(async (_plugin: string, _provider: string, input: PluginClockRequest) => {
      const mutation = input.mutation;
      if (mutation?.type === "notification-started") model.countdowns[0].delivery.status = "sending";
      if (mutation?.type === "notification-succeeded") {
        if (failAcknowledgement) throw new Error("Synthetic acknowledgement storage failure");
        model.countdowns[0].delivery.status = "sent";
      }
      if (mutation?.type === "notification-failed") {
        model.countdowns[0].delivery = { status: "failed", attempts: 1, error: mutation.error };
      }
      if (mutation?.type === "notification-retry") model.countdowns[0].delivery = pendingClockDelivery();
      return structuredClone(model);
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useClocks({
      providers: [provider], request, notify, audio: audio(), clock: sampleClock, reportError: vi.fn(),
    }));
    await waitFor(() => expect(result.current.stateFor(provider).error).toBe("Synthetic acknowledgement storage failure"));
    failAcknowledgement = false;
    await act(async () => { await result.current.refresh(provider); });
    await waitFor(() => expect(result.current.alerts[0].error).toMatch(/may already have appeared/u));
    expect(notify).toHaveBeenCalledOnce();
    await act(async () => {
      await result.current.mutate(provider, { type: "notification-retry", kind: "countdown", id: "break", occurrence: 1 });
    });
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
  });

  it("batches an overdue backlog and limits stop-sound to current occurrences", async () => {
    const model = ringing();
    const original = model.countdowns[0];
    model.countdowns = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(original), id: `break-${index}` }));
    const request = vi.fn(async (_plugin: string, _provider: string, input: PluginClockRequest) => {
      const mutation = input.mutation;
      if (mutation && "id" in mutation) {
        const row = model.countdowns.find((item) => item.id === mutation.id)!;
        if (mutation.type === "notification-started") row.delivery.status = "sending";
        if (mutation.type === "notification-succeeded") row.delivery.status = "sent";
      }
      return structuredClone(model);
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const player = audio();
    const { result } = renderHook(() => useClocks({
      providers: [provider], request, notify, audio: player, clock: sampleClock, reportError: vi.fn(),
    }));
    await waitFor(() => expect(result.current.stateFor(provider).model?.countdowns.every((row) => row.delivery.status === "sent")).toBe(true));
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      provider.pluginId, "6 clocks need attention", "Open Denote to dismiss the alert or snooze an alarm.", true,
    );
    act(() => result.current.silence());
    expect(player.setRinging).toHaveBeenLastCalledWith(false);
    expect(result.current.alerts).toHaveLength(6);
    model.countdowns[0].occurrence += 1;
    model.countdowns[0].delivery = pendingClockDelivery();
    await act(async () => { await result.current.refresh(provider); });
    await waitFor(() => expect(player.setRinging).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
  });
});
