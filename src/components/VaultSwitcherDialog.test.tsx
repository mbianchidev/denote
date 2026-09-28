import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaultSwitcherDialog } from "./VaultSwitcherDialog";

describe("VaultSwitcherDialog", () => {
  it("keeps the clone surface open while the explicit clone action is running", async () => {
    const user = userEvent.setup();
    let finish: (started: boolean) => void = () => {};
    const onAction = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<VaultSwitcherDialog
      open
      onLoad={vi.fn().mockResolvedValue([])}
      onSwitch={vi.fn()}
      onDelete={vi.fn()}
      onChooseFolder={vi.fn()}
      onClose={vi.fn()}
      clone={{
        contextKey: "synthetic-vault", busy: false,
        remoteAccess: { authMode: "public", cloneAvailable: true, githubAvailable: false, repositories: [], cleanup: null, review: null },
        onChooseDestination: vi.fn().mockResolvedValue({ token: "synthetic-destination", path: "/synthetic/clone", withinVault: false }),
        onReleaseDestination: vi.fn().mockResolvedValue(undefined),
        onAction, onError: vi.fn(),
      }}
    />);
    await user.click(await screen.findByRole("button", { name: "Clone repo as vault" }));
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Repository URL"), "https://example.invalid/repo.git");
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    await screen.findByText("/synthetic/clone");
    await user.click(screen.getByRole("button", { name: "Clone" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close vault switcher" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open another folder" })).toBeDisabled();
    await act(async () => finish(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled());
  });

  it("starts clone onboarding from the switch-vault surface", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn().mockResolvedValue(true);
    const onChooseDestination = vi.fn().mockResolvedValue({
      token: "synthetic-destination",
      path: "/synthetic/clone",
      withinVault: false,
    });
    render(
      <VaultSwitcherDialog
        open
        onLoad={vi.fn().mockResolvedValue([])}
        onSwitch={vi.fn()}
        onDelete={vi.fn()}
        onChooseFolder={vi.fn()}
        clone={{
          contextKey: "synthetic-vault",
          busy: false,
          onChooseDestination,
          onReleaseDestination: vi.fn().mockResolvedValue(undefined),
          onError: vi.fn(),
          remoteAccess: {
            authMode: "public",
            cloneAvailable: true,
            githubAvailable: false,
            repositories: [],
            cleanup: null,
            review: null,
          },
          onAction,
        }}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Clone repo as vault" }),
    );
    await user.type(
      screen.getByLabelText("Repository URL"),
      "https://example.invalid/synthetic.git",
    );
    expect(screen.getByRole("button", { name: "Clone" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText("/synthetic/clone")).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clone" }));

    expect(onAction).toHaveBeenCalledWith(
      { id: "clone", values: { url: "https://example.invalid/synthetic.git" } },
      {
        gitCloneDestinationToken: "synthetic-destination",
        gitCloneDestinationPath: "/synthetic/clone",
      },
    );
  });

  it("switches to an available recent vault", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <VaultSwitcherDialog
        open
        onLoad={vi.fn().mockResolvedValue([
          {
            id: 1,
            name: "Work",
            path: String.raw`\\?\C:\vaults\work`,
            lastOpenedAt: "2026-08-28T10:00:00Z",
            available: true,
            current: false,
            default: true,
          },
          {
            id: 2,
            name: "Music",
            path: "/vaults/music",
            lastOpenedAt: "2026-08-27T10:00:00Z",
            available: true,
            current: true,
            default: false,
          },
        ])}
        onSwitch={onSwitch}
        onDelete={vi.fn()}
        onChooseFolder={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /Work/ }));

    expect(onSwitch).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByText(/Built-in guide/)).toBeInTheDocument();
    expect(screen.getByText(String.raw`C:\vaults\work`)).toBeInTheDocument();
    expect(
      screen.queryByText(String.raw`\\?\C:\vaults\work`),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Music/ })).toBeDisabled();
  });

  it("can move a removed vault folder to system Trash", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <VaultSwitcherDialog
        open
        onLoad={vi.fn().mockResolvedValue([
          {
            id: 3,
            name: "Random",
            path: "/vaults/random",
            lastOpenedAt: "2026-08-28T10:00:00Z",
            available: true,
            current: false,
            default: false,
          },
        ])}
        onSwitch={vi.fn()}
        onDelete={onDelete}
        onChooseFolder={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Remove Random from vault list",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /Also move the vault folder to system Trash/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Move folder to Trash" }),
    );

    expect(onDelete).toHaveBeenCalledWith(3, true);
  });
});
