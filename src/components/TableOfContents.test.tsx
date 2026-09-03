import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableOfContents } from "./TableOfContents";

describe("TableOfContents", () => {
  it("keeps stable entries visible while a replacement outline is loading", () => {
    render(
      <TableOfContents
        headings={[
          { depth: 1, text: "Introduction", slug: "introduction" },
        ]}
        loading
        onNavigate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Introduction" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Add headings to build an outline."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Building outline…")).not.toBeInTheDocument();
  });

  it("distinguishes initial loading from a confirmed empty outline", () => {
    const { rerender } = render(
      <TableOfContents headings={[]} loading onNavigate={vi.fn()} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Building outline…");
    expect(
      screen.queryByText("Add headings to build an outline."),
    ).not.toBeInTheDocument();

    rerender(
      <TableOfContents headings={[]} loading={false} onNavigate={vi.fn()} />,
    );

    expect(
      screen.getByText("Add headings to build an outline."),
    ).toBeVisible();
  });
});
