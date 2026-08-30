import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityRail } from "./ActivityRail";

describe("ActivityRail", () => {
  it("opens About Denote from a named button", async () => {
    const user = userEvent.setup();
    const onAbout = vi.fn();
    render(
      <ActivityRail
        activeView="files"
        theme="dark"
        onViewChange={vi.fn()}
        onAbout={onAbout}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "About Denote" }));
    expect(onAbout).toHaveBeenCalledOnce();
  });
});
