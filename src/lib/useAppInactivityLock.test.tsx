import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppInactivityLock } from "./useAppInactivityLock";

describe("useAppInactivityLock", () => {
  afterEach(() => vi.useRealTimers());

  it("is disabled by default and locks only after the full configured idle interval", async () => {
    vi.useFakeTimers();
    const lock = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const { rerender } = renderHook(
      ({ minutes }: { minutes: number | null }) =>
        useAppInactivityLock(minutes, lock, onError),
      { initialProps: { minutes: null as number | null } },
    );
    await act(() => vi.advanceTimersByTimeAsync(300_000));
    expect(lock).not.toHaveBeenCalled();

    rerender({ minutes: 1 });
    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(lock).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "a" });
    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(lock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(lock).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the idle interval when the wall clock moves backwards", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    const lock = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAppInactivityLock(1, lock, vi.fn()));
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    vi.setSystemTime(Date.now() - 3_600_000);
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(lock).toHaveBeenCalledTimes(1);
  });
});
