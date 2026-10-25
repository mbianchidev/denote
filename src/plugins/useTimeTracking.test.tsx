import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTimeTracking } from "./useTimeTracking";
import type { PluginTimeTrackingModel } from "@denote/plugin-sdk";

const provider = { pluginId: "denote.synthetic", id: "denote.synthetic.timer", title: "Time tracking" };
const model: PluginTimeTrackingModel = { sessions: [], activeSessionId: null, activeElsewhere: false, notices: [] };

describe("time-tracking host", () => {
  it("uses native clock samples, serializes actions, and rechecks on wake/focus", async () => {
    const clock = vi.fn().mockResolvedValue({ bootId: "synthetic-boot", wallTimeMs: 10_000, monotonicMs: 1_000 });
    const request = vi.fn().mockResolvedValue(model);
    const reportError = vi.fn();
    const { result } = renderHook(() => useTimeTracking({
      providers: [provider], workspaceId: "vault-alpha", request, clock, reportError,
    }));
    await waitFor(() => expect(result.current.stateFor(provider).model).toEqual(model));
    const mutation = { type: "stop" as const, id: "session-1" };
    await act(async () => { await result.current.mutate(provider, mutation); });
    expect(request).toHaveBeenLastCalledWith(provider.pluginId, provider.id, {
      workspaceId: "vault-alpha", clock: await clock.mock.results[0].value, mutation,
    });
    const count = request.mock.calls.length;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(count));
    expect(reportError).not.toHaveBeenCalled();
  });

  it("withdraws old-vault models immediately and ignores in-flight responses after switching", async () => {
    const clock = vi.fn().mockResolvedValue({ bootId: "synthetic-boot", wallTimeMs: 10_000, monotonicMs: 1_000 });
    let finish: (value: typeof model) => void = () => {};
    const request = vi.fn().mockImplementationOnce(() => new Promise<typeof model>((resolve) => { finish = resolve; }))
      .mockResolvedValue(model);
    const { result, rerender } = renderHook(({ workspaceId }) => useTimeTracking({
      providers: [provider], workspaceId, request, clock, reportError: vi.fn(),
    }), { initialProps: { workspaceId: "vault-alpha" } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ workspaceId: "vault-beta" });
    expect(result.current.stateFor(provider).model).toBeNull();
    await act(async () => { finish({ ...model, notices: ["Synthetic old-vault notice"] }); });
    await waitFor(() => expect(result.current.stateFor(provider).model).toEqual(model));
  });

  it("does no clock or worker work without an enabled provider", async () => {
    const clock = vi.fn();
    const request = vi.fn();
    renderHook(() => useTimeTracking({
      providers: [], workspaceId: "vault-alpha", request, clock, reportError: vi.fn(),
    }));
    expect(clock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not revive an old model when the same provider is unloaded and registered again", async () => {
    const clock = vi.fn().mockResolvedValue({ bootId: "synthetic-boot", wallTimeMs: 10_000, monotonicMs: 1_000 });
    let finish: (value: PluginTimeTrackingModel) => void = () => {};
    const oldModel = { ...model, notices: ["Synthetic previous runtime"] };
    const request = vi.fn().mockResolvedValueOnce(oldModel)
      .mockImplementationOnce(() => new Promise<PluginTimeTrackingModel>((resolve) => { finish = resolve; }));
    const rendered = renderHook(({ enabled }) => useTimeTracking({
      providers: enabled ? [provider] : [], workspaceId: "vault-alpha", request, clock, reportError: vi.fn(),
    }), { initialProps: { enabled: true } });
    await waitFor(() => expect(rendered.result.current.stateFor(provider).model).toEqual(oldModel));
    rendered.rerender({ enabled: false });
    rendered.rerender({ enabled: true });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(rendered.result.current.stateFor(provider).model).toBeNull();
    await act(async () => { finish(model); });
    await waitFor(() => expect(rendered.result.current.stateFor(provider).model).toEqual(model));
  });
});
