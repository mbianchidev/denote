import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createEmptySearchFilters,
  type SearchFilters,
} from "../lib/search";
import { SearchPanel } from "./SearchPanel";

describe("SearchPanel", () => {
  it("focuses and selects the current-file location on request", async () => {
    render(
      <SearchPanel
        query=""
        location="docs/Guide.md"
        filters={createEmptySearchFilters()}
        focusLocationRequest={1}
        results={[]}
        searching={false}
        tagColors={{}}
        onQueryChange={vi.fn()}
        onLocationChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onOpenResult={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Where to search" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("docs/Guide.md");
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(
      "docs/Guide.md".length,
    );
  });

  it("exposes visual tag, type, recency, and bookmark filters", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [filters, setFilters] = useState<SearchFilters>(
        createEmptySearchFilters(),
      );
      return (
        <SearchPanel
          query=""
          location="*"
          filters={filters}
          focusLocationRequest={0}
          results={[]}
          searching={false}
          tagColors={{}}
          onQueryChange={vi.fn()}
          onLocationChange={vi.fn()}
          onFiltersChange={setFilters}
          onOpenResult={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.type(
      screen.getByRole("textbox", { name: "Tags" }),
      "work, research",
    );
    await user.click(screen.getByRole("checkbox", { name: "Markdown" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Recency" }),
      "7",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Bookmark" }),
      "true",
    );

    expect(
      screen.getByRole("button", { name: "Filters (5)" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Tags" })).toHaveValue(
      "work, research",
    );
    expect(screen.getByRole("checkbox", { name: "Markdown" })).toBeChecked();
  });
});
