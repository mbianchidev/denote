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
        activePluginView={null}
        pluginViews={[]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={vi.fn()}
        onAbout={onAbout}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "About Denote" }));
    expect(onAbout).toHaveBeenCalledOnce();
  });

  it("opens a registered plugin sidebar view", async () => {
    const user = userEvent.setup();
    const onPluginViewChange = vi.fn();
    render(
      <ActivityRail
        activeView="files"
        activePluginView={null}
        pluginViews={[{ id: "denote.reference.status", title: "Plugin reference" }]}
        theme="dark"
        onViewChange={vi.fn()}
        onPluginViewChange={onPluginViewChange}
        onAbout={vi.fn()}
        onThemeToggle={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Plugin reference" }),
    );

    expect(onPluginViewChange).toHaveBeenCalledWith(
      "denote.reference.status",
    );
  });
});
