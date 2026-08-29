import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExternalLinkDialog } from "./ExternalLinkDialog";

describe("ExternalLinkDialog", () => {
  it("offers exact-domain and wildcard trust choices", async () => {
    const user = userEvent.setup();
    const onAllowDomain = vi.fn();
    const onAllowAll = vi.fn();
    render(
      <ExternalLinkDialog
        open
        kind="domain"
        subject="example.com"
        url="https://example.com/path"
        onAllow={onAllowDomain}
        onAllowAll={onAllowAll}
        onCancel={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Allow example.com" }),
    );
    expect(onAllowDomain).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole("button", {
        name: "Allow all external domains",
      }),
    );
    expect(onAllowAll).toHaveBeenCalledOnce();
  });

  it("requires one-time confirmation for custom protocols", () => {
    render(
      <ExternalLinkDialog
        open
        kind="protocol"
        subject="my-app"
        url="my-app://open/item"
        onAllow={vi.fn()}
        onAllowAll={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Open my-app link" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Allow all external domains",
      }),
    ).not.toBeInTheDocument();
  });
});
