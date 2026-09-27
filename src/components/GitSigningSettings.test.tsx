import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GitSigningStatus } from "../types";
import { GitSigningSettings } from "./GitSigningSettings";

const status: GitSigningStatus = {
  format: "openpgp",
  program: "/synthetic/gpg",
  key: "A".repeat(40),
  keySource: "Git configuration",
  credentialId: "b".repeat(64),
  hasSavedPassphrase: false,
  guidance: "Synthetic signing key.",
};

function props() {
  return {
    settings: {},
    disabled: false,
    dirty: false,
    onInspect: vi.fn().mockResolvedValue(status),
    onSave: vi.fn().mockResolvedValue({ ...status, hasSavedPassphrase: true }),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
  };
}

describe("GitSigningSettings", () => {
  it("detects only on request and saves a password outside ordinary settings", async () => {
    const user = userEvent.setup();
    const actions = props();
    render(<GitSigningSettings {...actions} />);
    expect(actions.onInspect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Detect signing key" }));
    expect(await screen.findByText(status.key!)).toBeInTheDocument();
    const password = screen.getByLabelText("Save passphrase for this key");
    expect(password).toHaveAttribute("type", "password");
    await user.type(password, "synthetic password");
    await user.click(screen.getByRole("button", { name: "Save passphrase" }));
    expect(actions.onSave).toHaveBeenCalledWith(status.credentialId, "synthetic password");
    expect(password).toHaveValue("");
    expect(await screen.findByText("Passphrase saved in the OS credential store.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete saved passphrase" }));
    expect(actions.onDelete).toHaveBeenCalledWith(status.credentialId);
    expect(await screen.findByText("No passphrase saved for this key.")).toBeInTheDocument();
  });

  it("clears the password and old selection when settings change", async () => {
    const user = userEvent.setup();
    const actions = props();
    const view = render(<GitSigningSettings {...actions} />);
    await user.click(screen.getByRole("button", { name: "Detect signing key" }));
    await user.type(await screen.findByLabelText("Save passphrase for this key"), "synthetic password");
    view.rerender(<GitSigningSettings {...actions} settings={{ gpgSigningKey: "different" }} dirty />);
    expect(screen.queryByLabelText("Save passphrase for this key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detect signing key" })).toBeDisabled();
  });

  it("reports save failures and clears input without logging its content", async () => {
    const user = userEvent.setup();
    const actions = props();
    actions.onSave.mockRejectedValue(new Error("OS credential store is unavailable."));
    render(<GitSigningSettings {...actions} />);
    await user.click(screen.getByRole("button", { name: "Detect signing key" }));
    const password = await screen.findByLabelText("Save passphrase for this key");
    await user.type(password, "synthetic password");
    await user.click(screen.getByRole("button", { name: "Save passphrase" }));
    await waitFor(() => expect(actions.onError).toHaveBeenCalled());
    expect(password).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("OS credential store is unavailable");
    expect(JSON.stringify(actions.onError.mock.calls)).not.toContain("synthetic password");
  });

  it("provides distinct Windows and macOS/Linux key-location commands", () => {
    render(<GitSigningSettings {...props()} />);
    expect(screen.getByText("Windows (PowerShell)")).toBeInTheDocument();
    expect(screen.getByText("macOS / Linux")).toBeInTheDocument();
    expect(screen.getAllByText(/gpg --list-secret-keys --keyid-format=long/)).toHaveLength(2);
    expect(screen.getByText(/Get-Command gpg/)).toBeInTheDocument();
    expect(screen.getByText(/command -v gpg/)).toBeInTheDocument();
  });

  it("discards detection from a previous repository", async () => {
    const user = userEvent.setup();
    const actions = props();
    let complete: (value: GitSigningStatus) => void = () => {};
    actions.onInspect.mockImplementation(() => new Promise<GitSigningStatus>((resolve) => { complete = resolve; }));
    const view = render(<GitSigningSettings {...actions} contextKey="vault-one" />);
    await user.click(screen.getByRole("button", { name: "Detect signing key" }));
    view.rerender(<GitSigningSettings {...actions} contextKey="vault-two" />);
    complete(status);
    await waitFor(() => expect(screen.getByRole("button", { name: "Detect signing key" })).toBeEnabled());
    expect(screen.queryByText(status.key!)).not.toBeInTheDocument();
  });

  it("reflects credentials cleared outside the key-specific form", async () => {
    const user = userEvent.setup();
    const actions = props();
    actions.onInspect.mockResolvedValue({ ...status, hasSavedPassphrase: true });
    const view = render(<GitSigningSettings {...actions} hasCredentials />);
    await user.click(screen.getByRole("button", { name: "Detect signing key" }));
    expect(await screen.findByText("Passphrase saved in the OS credential store.")).toBeInTheDocument();
    view.rerender(<GitSigningSettings {...actions} hasCredentials={false} />);
    expect(screen.getByText("No passphrase saved for this key.")).toBeInTheDocument();
  });
});
