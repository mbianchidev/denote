import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KnownVaultFileBatch } from "../types";
import { GlobalSearchDialog } from "./GlobalSearchDialog";

const batch: KnownVaultFileBatch = {
  files: [
    {
      vaultId: 1,
      vaultName: "Work",
      path: "projects/Atlas.md",
      fileName: "Atlas.md",
      current: true,
      default: false,
    },
    {
      vaultId: 2,
      vaultName: "Music",
      path: "songs/Set list.md",
      fileName: "Set list.md",
      current: false,
      default: false,
    },
  ],
  skippedVaultCount: 0,
  skippedEntryCount: 0,
  truncated: false,
};

describe("GlobalSearchDialog", () => {
  it("filters by filename only and opens the selected vault file", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <GlobalSearchDialog
        open
        onLoad={async () => batch}
        onOpen={onOpen}
        onClose={vi.fn()}
      />,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search filenames across vaults",
    });
    await user.type(input, "atlas");

    expect(
      screen.getByRole("option", { name: /Atlas\.md.*Work/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Set list\.md/i }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(batch.files[0]);
  });

  it("does not match folder paths when the filename does not match", async () => {
    const user = userEvent.setup();
    render(
      <GlobalSearchDialog
        open
        onLoad={async () => batch}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(
      await screen.findByRole("combobox", {
        name: "Search filenames across vaults",
      }),
      "projects",
    );

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
