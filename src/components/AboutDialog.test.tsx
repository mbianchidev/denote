import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  it("shows artifact version and commit with accessible close behavior", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <AboutDialog
        open
        buildInfo={{
          version: "1.2.3",
          commitHash: "1234567890abcdef1234567890abcdef12345678",
          dirty: false,
        }}
        runtimeInfo={{
          operatingSystem: "macos",
          architecture: "aarch64",
          bundleType: "app",
          updateChannel: "stable",
          updaterConfigured: true,
        }}
        updateState={{ status: "idle" }}
        onCheckForUpdates={vi.fn()}
        onInstallUpdate={vi.fn()}
        onReportBug={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "About Denote" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("1234567890ab")).toBeInTheDocument();
    expect(
      screen.getByText("1234567890abcdef1234567890abcdef12345678"),
    ).toBeInTheDocument();
    expect(screen.getByText("Clean commit")).toBeInTheDocument();
    expect(screen.getByText("macos · aarch64")).toBeInTheDocument();
    expect(screen.getByText("stable")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close About Denote" }),
      ).toHaveFocus(),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers report and signed update actions accessibly", async () => {
    const user = userEvent.setup();
    const onInstallUpdate = vi.fn();
    const onReportBug = vi.fn();
    render(
      <AboutDialog
        open
        buildInfo={{
          version: "1.2.3",
          commitHash: "1234567890abcdef1234567890abcdef12345678",
          dirty: false,
        }}
        runtimeInfo={{
          operatingSystem: "windows",
          architecture: "x86_64",
          bundleType: "nsis",
          updateChannel: "stable",
          updaterConfigured: true,
        }}
        updateState={{
          status: "available",
          update: { version: "1.2.4", notes: "Synthetic release notes." },
        }}
        onCheckForUpdates={vi.fn()}
        onInstallUpdate={onInstallUpdate}
        onReportBug={onReportBug}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Report a bug" }));
    expect(onReportBug).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Update Denote" }));
    expect(onInstallUpdate).toHaveBeenCalledWith({
      version: "1.2.4",
      notes: "Synthetic release notes.",
    });
  });

  it("explains the fail-closed unconfigured channel", () => {
    render(
      <AboutDialog
        open
        buildInfo={{
          version: "1.2.3",
          commitHash: "1234567890abcdef1234567890abcdef12345678",
          dirty: false,
        }}
        runtimeInfo={{
          operatingSystem: "linux",
          architecture: "x86_64",
          bundleType: "appimage",
          updateChannel: "stable",
          updaterConfigured: false,
        }}
        updateState={{ status: "idle" }}
        onCheckForUpdates={vi.fn()}
        onInstallUpdate={vi.fn()}
        onReportBug={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "The stable update channel is not configured with a trusted public key.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeDisabled();
  });
});
