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
});
