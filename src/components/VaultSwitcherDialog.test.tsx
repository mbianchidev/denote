import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaultSwitcherDialog } from "./VaultSwitcherDialog";

describe("VaultSwitcherDialog", () => {
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
            path: "/vaults/work",
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
