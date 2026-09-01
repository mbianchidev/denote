import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GitProjectSuggestion } from "./GitProjectSuggestion";

describe("GitProjectSuggestion", () => {
  it("offers an accessible project action without marking automatically", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <GitProjectSuggestion onAccept={onAccept} onDecline={onDecline} />,
    );

    expect(
      screen.getByRole("complementary", {
        name: "This vault looks like a Git repository.",
      }),
    ).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Mark as project" }));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("dismisses the suggestion only after an explicit decline", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn();
    render(
      <GitProjectSuggestion onAccept={vi.fn()} onDecline={onDecline} />,
    );

    await user.click(screen.getByRole("button", { name: "No thanks" }));
    expect(onDecline).toHaveBeenCalledOnce();
  });
});
