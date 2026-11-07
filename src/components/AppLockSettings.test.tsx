import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppLockSettings } from "./AppLockSettings";
import type { AppLockStatus } from "../types";

const disabled: AppLockStatus = {
  enabled: false,
  locked: false,
  passwordEnabled: false,
  deviceAuthenticationEnabled: false,
  inactivityMinutes: null,
  deviceAuthentication: {
    available: true,
    name: "Touch ID",
    unavailableReason: null,
  },
};

describe("AppLockSettings", () => {
  it("enables a chosen password with inactivity disabled and clears every password field", async () => {
    const user = userEvent.setup();
    const configure = vi.fn().mockResolvedValue(undefined);
    render(<AppLockSettings status={disabled} disabled={false} onConfigure={configure} onLock={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "Enable app lock" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Enable app lock" }));
    expect(screen.getByLabelText("Lock after inactivity")).toHaveValue("");
    await user.type(screen.getByLabelText("New app password"), "synthetic app password");
    await user.type(screen.getByLabelText("Confirm app password"), "synthetic app password");
    await user.click(screen.getByRole("button", { name: "Save app lock" }));

    expect(configure).toHaveBeenCalledWith({
      password: { kind: "set", value: "synthetic app password" },
      currentPassword: null,
      deviceAuthenticationEnabled: false,
      inactivityMinutes: null,
    });
    expect(screen.getByLabelText("New app password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm app password")).toHaveValue("");
  });

  it("clears partially entered passwords when settings are closed", async () => {
    const user = userEvent.setup();
    const props = { status: disabled, disabled: false, onConfigure: vi.fn(), onLock: vi.fn() };
    const { rerender } = render(<AppLockSettings {...props} active />);
    await user.click(screen.getByRole("checkbox", { name: "Enable app lock" }));
    const password = screen.getByLabelText("New app password");
    await user.type(password, "synthetic partial password");
    rerender(<AppLockSettings {...props} active={false} />);
    expect(password).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Enable app lock" })).not.toBeChecked();
  });
});
