import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialRequest, CredentialResult } from "../lib/credentials";
import { CredentialStorePanel } from "./CredentialStorePanel";

const native = vi.hoisted(() => ({ store: vi.fn(), transfer: vi.fn(), stop: vi.fn() }));
vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(),
  api: { credentialStore: native.store, credentialTransfer: native.transfer, stopSensitiveTools: native.stop },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const entry = { id: "11111111-2222-4333-8444-555555555555", service: "Synthetic service", username: "synthetic-user", url: "https://synthetic.invalid", notes: "Invented private note" };
const snapshot = { kind: "snapshot" as const, session: "synthetic-session", hash: "a".repeat(64), entries: [entry] };

beforeEach(() => {
  vi.clearAllMocks();
  native.store.mockImplementation(async (_plugin: string, _scope: string, request: CredentialRequest): Promise<CredentialResult> => {
    switch (request.action) {
      case "status": return { kind: "status", exists: true };
      case "unlock":
        if (request.password !== "synthetic master password") throw new Error("Credential authentication failed.");
        return structuredClone(snapshot);
      case "reveal": return { kind: "revealed", value: "invented-secret-canary" };
      case "list": case "upsert": return structuredClone(snapshot);
      case "export":
        if (!request.confirmed || request.password !== "synthetic master password") throw new Error("Export authentication failed.");
        return { kind: "done" };
      default: return { kind: "done" };
    }
  });
  native.transfer.mockResolvedValue({ kind: "prepared", ticket: "synthetic-ticket" });
  native.stop.mockResolvedValue(undefined);
});

async function unlock() {
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Master password");
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "synthetic master password");
  await user.click(screen.getByRole("button", { name: "Unlock credential store" }));
  await screen.findByRole("table", { name: "Unlocked credential entries" });
  return user;
}

describe("credential store host controls", () => {
  it("keeps secrets masked, reveals explicitly, copies fields natively, and clears all visible metadata on focus loss", async () => {
    render(<CredentialStorePanel pluginId="denote.credential-store" workspaceScope="/synthetic" onClose={() => {}} />);
    const user = await unlock();
    expect(screen.queryByText("invented-secret-canary")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show secret for Synthetic service" }));
    expect(await screen.findByText("invented-secret-canary")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Copy username for Synthetic service" }));
    expect(native.store).toHaveBeenCalledWith("denote.credential-store", "/synthetic",
      expect.objectContaining({ action: "copy", field: "username", session: "synthetic-session" }));
    fireEvent(window, new Event("blur"));
    expect(screen.queryByText("invented-secret-canary")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic service")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toHaveValue("");
    await waitFor(() => expect(native.store).toHaveBeenCalledWith("denote.credential-store", "/synthetic", { action: "lock", session: "synthetic-session" }));
  });

  it("does not turn a failed unlock into a new empty store", async () => {
    render(<CredentialStorePanel pluginId="denote.credential-store" workspaceScope="/synthetic" onClose={() => {}} />);
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Master password");
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "wrong synthetic password");
    await user.click(screen.getByRole("button", { name: "Unlock credential store" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Credential authentication failed.");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create credential store" })).not.toBeInTheDocument();
  });

  it("requires a fresh master password and explicit risk confirmation for every plaintext export", async () => {
    render(<CredentialStorePanel pluginId="denote.credential-store" workspaceScope="/synthetic" onClose={() => {}} />);
    const user = await unlock();
    await user.click(screen.getByRole("button", { name: "Plaintext export" }));
    const password = await screen.findByLabelText("Current master password");
    expect(password).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Export plaintext" }));
    expect(native.store.mock.calls.some(([, , request]) => request.action === "export")).toBe(false);
    await user.type(password, "synthetic master password");
    await user.click(screen.getByRole("checkbox", { name: /exposes every credential in plaintext/ }));
    await user.click(screen.getByRole("button", { name: "Export plaintext" }));
    await waitFor(() => expect(native.store).toHaveBeenCalledWith("denote.credential-store", "/synthetic", {
      action: "export", ticket: "synthetic-ticket", password: "synthetic master password", confirmed: true,
    }));
    expect(screen.getByText(/^Plaintext export saved/)).toHaveAttribute("role", "status");
  });

  it("edits without revealing the old secret and retains a recoverable draft after a save conflict", async () => {
    render(<CredentialStorePanel pluginId="denote.credential-store" workspaceScope="/synthetic" onClose={() => {}} />);
    const user = await unlock();
    await user.click(screen.getByRole("button", { name: "Edit Synthetic service" }));
    expect(screen.queryByLabelText("Password or token")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Service"));
    await user.type(screen.getByLabelText("Service"), "Revised invented service");
    const invoke = native.store.getMockImplementation();
    if (!invoke) throw new Error("Missing synthetic native host.");
    native.store.mockImplementation((plugin: string, scope: string, request: CredentialRequest) =>
      request.action === "upsert" ? Promise.reject(new Error("This credential edit is stale.")) : invoke(plugin, scope, request));
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stale");
    expect(screen.getByLabelText("Service")).toHaveValue("Revised invented service");
    const request = native.store.mock.calls[native.store.mock.calls.length - 1]?.[2];
    expect(request).toMatchObject({ action: "upsert", entry: { secret: null } });
  });
});
