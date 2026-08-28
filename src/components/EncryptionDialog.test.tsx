import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EncryptionDialog } from "./EncryptionDialog";

describe("EncryptionDialog", () => {
  it("requires recovery-code acknowledgement after enabling encryption", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onEnable = vi
      .fn()
      .mockResolvedValue(["AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111"]);

    render(
      <EncryptionDialog
        open
        encryption={{
          enabled: false,
          unlocked: true,
          phase: null,
          remainingRecoveryCodes: 0,
        }}
        onClose={onClose}
        onEnable={onEnable}
        onLock={vi.fn()}
        onChangePassword={vi.fn()}
        onRegenerateRecoveryCodes={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Enable encryption" }),
    );
    await user.type(screen.getByLabelText("New password"), "long password");
    await user.type(screen.getByLabelText("Confirm password"), "long password");
    await user.click(screen.getByRole("button", { name: "Encrypt vault" }));

    expect(
      await screen.findByText("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close vault security" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", {
        name: "I saved the recovery codes somewhere safe.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onEnable).toHaveBeenCalledWith("long password");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
