import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloneOnboarding, type CloneOnboardingProps } from "./SourceControlPanel";

const destination = { token: "synthetic-destination", path: "/synthetic/clone", withinVault: false };

function props(overrides: Partial<CloneOnboardingProps> = {}): CloneOnboardingProps {
  return {
    contextKey: "synthetic-vault",
    remoteAccess: {
      authMode: "public", cloneAvailable: true, githubAvailable: false,
      repositories: [], cleanup: null, review: null,
    },
    busy: false,
    onChooseDestination: vi.fn().mockResolvedValue(destination),
    onReleaseDestination: vi.fn().mockResolvedValue(undefined),
    onAction: vi.fn().mockResolvedValue(true),
    onError: vi.fn(),
    ...overrides,
  };
}

describe("CloneOnboarding", () => {
  it("keeps the chosen folder if changing it or confirming the clone is cancelled", async () => {
    const user = userEvent.setup();
    const onChooseDestination = vi.fn().mockResolvedValueOnce(destination).mockResolvedValueOnce(null);
    const actions = props({ onChooseDestination, onAction: vi.fn().mockResolvedValue(false) });
    render(<CloneOnboarding {...actions} />);
    await user.type(screen.getByLabelText("Repository URL"), "https://example.invalid/repo.git");
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText(destination.path)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change folder" }));
    expect(screen.getByRole("button", { name: "Clone" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Clone" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Clone" })).toBeEnabled());
    expect(actions.onReleaseDestination).not.toHaveBeenCalled();
  });

  it("reports folder validation errors without starting a clone", async () => {
    const user = userEvent.setup();
    const actions = props({
      onChooseDestination: vi.fn().mockRejectedValue(new Error("The destination must be empty.")),
    });
    render(<CloneOnboarding {...actions} />);
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The destination must be empty.");
    expect(screen.getByRole("button", { name: "Clone" })).toBeDisabled();
    expect(actions.onAction).not.toHaveBeenCalled();
    expect(actions.onError).toHaveBeenCalledTimes(1);
  });

  it("shows host preparation failures without losing the unspent folder selection", async () => {
    const user = userEvent.setup();
    const actions = props({ onAction: vi.fn().mockRejectedValue(new Error("Save open notes before cloning.")) });
    render(<CloneOnboarding {...actions} />);
    await user.type(screen.getByLabelText("Repository URL"), "https://example.invalid/repo.git");
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    await screen.findByText(destination.path);
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save open notes before cloning.");
    expect(screen.getByRole("button", { name: "Clone" })).toBeEnabled();
    expect(actions.onReleaseDestination).not.toHaveBeenCalled();
  });

  it("releases a selection that arrives after the form closes", async () => {
    const user = userEvent.setup();
    let finish: (selected: typeof destination) => void = () => {};
    const actions = props({
      onChooseDestination: () => new Promise((resolve) => { finish = resolve; }),
    });
    const view = render(<CloneOnboarding {...actions} />);
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    view.unmount();
    await act(async () => finish(destination));
    expect(actions.onReleaseDestination).toHaveBeenCalledWith(destination.token);
    expect(actions.onAction).not.toHaveBeenCalled();
  });

  it("releases a selected folder on close without cloning or deleting its contents", async () => {
    const user = userEvent.setup();
    const actions = props();
    const view = render(<CloneOnboarding {...actions} />);
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    await screen.findByText(destination.path);
    view.unmount();
    expect(actions.onReleaseDestination).toHaveBeenCalledWith(destination.token);
    expect(actions.onAction).not.toHaveBeenCalled();
  });

  it("shows progress, cancellation, and native recovery failures in the clone surface", async () => {
    const user = userEvent.setup();
    const actions = props({
      busy: true,
      busyMessage: "Cloning the selected repository",
      activeOperationId: "synthetic-operation",
    });
    const view = render(<CloneOnboarding {...actions} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cloning the selected repository");
    await user.click(screen.getByRole("button", { name: "Cancel operation" }));
    expect(actions.onAction).toHaveBeenCalledWith({
      id: "cancel-operation", values: { operationId: "synthetic-operation" },
    });
    view.rerender(<CloneOnboarding {...actions} busy={false} recovery={{
      state: "failed", operationId: "synthetic-failure", message: "Git is not installed.",
    }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Git is not installed.");
  });

  it("retains the destination label after a failed attempt but requires a fresh empty-folder selection", async () => {
    const user = userEvent.setup();
    const actions = props();
    const view = render(<CloneOnboarding {...actions} />);
    await user.type(screen.getByLabelText("Repository URL"), "https://example.invalid/repo.git");
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    await screen.findByText(destination.path);
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(actions.onReleaseDestination).toHaveBeenCalledWith(destination.token);
    view.rerender(<CloneOnboarding {...actions} remoteAccess={{
      ...actions.remoteAccess,
      review: {
        operation: "Clone", outcome: "failed", summary: "The remote refused the clone.",
        detail: "The chosen folder was left intact.", retryActionId: "refresh",
      },
    }} />);
    expect(screen.getByText("Clone: The remote refused the clone.")).toBeInTheDocument();
    expect(screen.getByText(destination.path)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change folder" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Refresh repository" })).toBeInTheDocument();
  });
});
