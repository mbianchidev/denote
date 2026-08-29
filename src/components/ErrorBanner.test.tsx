import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ErrorBanner,
  TRANSIENT_ERROR_DURATION_MS,
} from "./ErrorBanner";

describe("ErrorBanner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers keyboard-accessible error navigation", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ErrorBanner
        message="Line 3, column 2: Invalid Markdown"
        onNavigate={onNavigate}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Navigate to error" }));
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("automatically dismisses transient link alerts", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ErrorBanner
        message="Link target not found"
        transient
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Link target not found");

    act(() => vi.advanceTimersByTime(TRANSIENT_ERROR_DURATION_MS));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
