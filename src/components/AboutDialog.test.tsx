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
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close About Denote" }),
      ).toHaveFocus(),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
