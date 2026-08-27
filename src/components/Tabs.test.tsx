import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EditorTab } from "../types";
import { Tabs } from "./Tabs";

const tabs: EditorTab[] = [
  {
    path: "one.md",
    title: "one.md",
    kind: "markdown",
    content: "",
    savedContent: "",
    editRecorded: false,
    saveState: "saved",
  },
  {
    path: "two.md",
    title: "two.md",
    kind: "markdown",
    content: "",
    savedContent: "",
    editRecorded: false,
    saveState: "dirty",
  },
];

describe("Tabs", () => {
  it("activates and closes files through accessible controls", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(
      <Tabs
        tabs={tabs}
        activePath="one.md"
        onActivate={onActivate}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /two\.md/i }));
    await user.click(screen.getByRole("button", { name: "Close two.md" }));

    expect(onActivate).toHaveBeenCalledWith("two.md");
    expect(onClose).toHaveBeenCalledWith("two.md");
  });
});
