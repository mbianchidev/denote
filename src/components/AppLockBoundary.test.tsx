import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLockBoundary } from "./AppLockBoundary";

const mockApi = vi.hoisted(() => ({
  getAppLockStatus: vi.fn(),
  unlockAppWithPassword: vi.fn(),
  unlockAppWithDevice: vi.fn(),
  lockApp: vi.fn(),
  configureAppLock: vi.fn(),
  completeExit: vi.fn(),
}));

const mockWindow = vi.hoisted(() => ({
  closeHandler: null as ((event: { preventDefault: () => void }) => Promise<void>) | null,
  onCloseRequested: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mockWindow }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

vi.mock("../lib/api", () => ({
  api: mockApi,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const unlocked = {
  enabled: true,
  locked: false,
  passwordEnabled: true,
  deviceAuthenticationEnabled: true,
  inactivityMinutes: null,
  deviceAuthentication: {
    available: true,
    name: "Touch ID",
    unavailableReason: null,
  },
};
const locked = { ...unlocked, locked: true };

describe("AppLockBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAppLockStatus.mockResolvedValue(locked);
    mockApi.unlockAppWithPassword.mockResolvedValue(unlocked);
    mockApi.unlockAppWithDevice.mockResolvedValue(unlocked);
    mockApi.lockApp.mockResolvedValue(locked);
    mockApi.completeExit.mockResolvedValue(undefined);
    mockWindow.closeHandler = null;
    mockWindow.onCloseRequested.mockImplementation(async (handler: typeof mockWindow.closeHandler) => {
      mockWindow.closeHandler = handler;
      return () => { mockWindow.closeHandler = null; };
    });
  });

  it("does not mount the workspace before successful native authorization", async () => {
    const user = userEvent.setup();
    const mountWorkspace = vi.fn(() => <p>Synthetic private workspace</p>);
    mockApi.unlockAppWithPassword.mockRejectedValueOnce(
      new Error("Incorrect app password."),
    );
    render(<AppLockBoundary>{mountWorkspace}</AppLockBoundary>);

    await screen.findByRole("heading", { name: "Denote is locked" });
    expect(mountWorkspace).not.toHaveBeenCalled();
    expect(mockApi.unlockAppWithDevice).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("App password"), "synthetic wrong password");
    await user.click(screen.getByRole("button", { name: "Unlock app" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect app password.");
    expect(screen.getByLabelText("App password")).toHaveValue("");
    expect(mountWorkspace).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("App password"), "synthetic correct password");
    await user.click(screen.getByRole("button", { name: "Unlock app" }));
    await screen.findByText("Synthetic private workspace");
    expect(mockApi.unlockAppWithPassword).toHaveBeenLastCalledWith(
      "synthetic correct password",
    );
  });

  it("withdraws the workspace and reports a failed lock until the user checks its state", async () => {
    const user = userEvent.setup();
    mockApi.getAppLockStatus.mockResolvedValue(unlocked);
    mockApi.lockApp.mockRejectedValue(new Error("Synthetic cleanup failed."));
    render(
      <AppLockBoundary>
        {(actions) => <section>
          <p>Synthetic private workspace</p>
          <button onClick={() => void actions.lock().catch(() => {})}>Lock fixture</button>
        </section>}
      </AppLockBoundary>,
    );
    await screen.findByText("Synthetic private workspace");
    await user.click(screen.getByRole("button", { name: "Lock fixture" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic cleanup failed.");
    expect(screen.queryByText("Synthetic private workspace")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Synthetic private workspace");
  });

  it("handles closing the locked app without a workspace-mounted exit handler", async () => {
    render(<AppLockBoundary>{() => <p>Synthetic private workspace</p>}</AppLockBoundary>);
    await screen.findByRole("heading", { name: "Denote is locked" });
    expect(mockWindow.closeHandler).not.toBeNull();
    const event = { preventDefault: vi.fn() };
    await act(async () => { await mockWindow.closeHandler?.(event); });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockApi.completeExit).toHaveBeenCalledTimes(1);
  });
});
