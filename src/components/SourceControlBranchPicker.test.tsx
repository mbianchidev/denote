import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceControlBranchPicker } from "./SourceControlBranchPicker";

const branches = [
  {
    name: "main",
    current: true,
    remote: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
  },
  {
    name: "topic",
    current: false,
    remote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  },
  {
    name: "origin/review",
    current: false,
    remote: true,
    upstream: null,
    ahead: 0,
    behind: 0,
  },
];

describe("SourceControlBranchPicker", () => {
  it("switches, creates from a chosen branch, and checks out a remote branch", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlBranchPicker
        branches={branches}
        currentBranch="main"
        busy={false}
        onAction={onAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Switch to topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "switch-branch",
      values: { branch: "topic", from: "main" },
    });

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Find or create branch" }),
      "feature/simple",
    );
    await user.selectOptions(screen.getByLabelText("Create from"), "topic");
    await user.click(
      screen.getByRole("button", {
        name: "Create feature/simple from topic and switch",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "create-branch",
      values: {
        name: "feature/simple",
        startPoint: "topic",
        checkout: true,
        from: "main",
      },
    });

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(
      screen.getByRole("button", {
        name: "Check out origin/review as review",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "checkout-remote-branch",
      values: {
        remoteBranch: "origin/review",
        localName: "review",
        from: "main",
      },
    });

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(
      screen.getByRole("button", { name: "Edit branch origin/review" }),
    );
    const remoteName = screen.getByLabelText("New name for origin/review");
    await user.clear(remoteName);
    await user.type(remoteName, "stable");
    await user.click(
      screen.getByRole("button", { name: "Rename origin/review" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "rename-remote-branch",
      values: { name: "origin/review", newName: "stable" },
    });

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(
      screen.getByRole("button", { name: "Delete origin/review" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "delete-remote-branch",
      values: { name: "origin/review" },
    });
  });
});
