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
  it("focuses the search text while keeping the current-file location", async () => {
    render(
      <SearchPanel
        query=""
        location="docs/Guide.md"
        filters={createEmptySearchFilters()}
        focusQueryRequest={1}
        results={[]}
        searching={false}
        tagColors={{}}
        onQueryChange={vi.fn()}
        onLocationChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onOpenResult={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Search text" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("textbox", { name: "Where to search" }),
    ).toHaveValue("docs/Guide.md");
  });

  it("opens a result with its search match", async () => {
    const user = userEvent.setup();
    const onOpenResult = vi.fn();
    const result = {
      document: {
        path: "docs/Guide.md",
        title: "Guide",
        content: "A synthetic needle example.",
        contentHash: "mock-hash",
        encoding: "utf8" as const,
        lineEnding: "lf" as const,
        tags: [],
        kind: "markdown" as const,
        bookmarked: false,
        lastOpenedAt: null,
      },
      score: 1,
      snippet: "A synthetic needle example.",
      match: { from: 12, to: 18 },
    };

    render(
      <SearchPanel
        query="needle"
        location="docs/Guide.md"
        filters={createEmptySearchFilters()}
        focusQueryRequest={0}
        results={[result]}
        searching={false}
        tagColors={{}}
        onQueryChange={vi.fn()}
        onLocationChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onOpenResult={onOpenResult}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Guide/ }));

    expect(onOpenResult).toHaveBeenCalledWith(result);
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
          focusQueryRequest={0}
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
