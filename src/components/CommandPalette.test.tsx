import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KnownVaultFileBatch } from "../types";
import {
  CommandPalette,
  type CommandPaletteCommand,
} from "./CommandPalette";

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

const commands: CommandPaletteCommand[] = [
  {
    id: "file.find",
    title: "Find file across vaults",
    description: "Search known vaults by filename.",
    category: "Navigation",
    shortcut: "⌘P",
    kind: "file-search",
  },
  {
    id: "file.rename",
    title: "Rename current file",
    description: "Rename the active file.",
    category: "File",
    run: vi.fn(),
  },
];

describe("CommandPalette", () => {
  it("shows commands with shortcuts and runs the selected command", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        commands={commands}
        onLoadFiles={async () => batch}
        onOpenFile={vi.fn()}
        onCommandError={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(
      await screen.findByRole("option", { name: /Find file across vaults/i }),
    ).toHaveTextContent("⌘P");
    await user.type(
      screen.getByRole("combobox", {
        name: "Search commands or filenames across vaults",
      }),
      "rename",
    );
    await user.keyboard("{Enter}");

    expect(commands[1].run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("finds and runs a plugin command by its title", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <CommandPalette
        open
        commands={[
          ...commands,
          {
            id: "denote.reference.verify-keychain",
            title: "Plugin host: verify keychain isolation",
            description: "Run command from denote.reference.",
            category: "Plugins",
            run,
          },
        ]}
        onLoadFiles={async () => batch}
        onOpenFile={vi.fn()}
        onCommandError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(
      await screen.findByRole("combobox", {
        name: "Search commands or filenames across vaults",
      }),
      "verify keychain isolation",
    );
    await user.click(
      screen.getByRole("option", { name: /verify keychain isolation/i }),
    );

    expect(run).toHaveBeenCalledOnce();
  });

  it("filters by filename only and opens the selected vault file", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <CommandPalette
        open
        commands={commands}
        onLoadFiles={async () => batch}
        onOpenFile={onOpen}
        onCommandError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = await screen.findByRole("combobox", {
      name: "Search commands or filenames across vaults",
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
      <CommandPalette
        open
        commands={commands}
        onLoadFiles={async () => batch}
        onOpenFile={vi.fn()}
        onCommandError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(
      await screen.findByRole("combobox", {
        name: "Search commands or filenames across vaults",
      }),
      "projects",
    );

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("switches to a file-only view from the find-file command", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        commands={commands}
        onLoadFiles={async () => batch}
        onOpenFile={vi.fn()}
        onCommandError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("option", { name: /Find file across vaults/i }),
    );

    expect(
      screen.getByRole("combobox", { name: "Search filenames across vaults" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: /Atlas\.md.*Work/i }),
    ).toBeInTheDocument();
  });

  it("does not execute a result while an IME composition is active", async () => {
    const run = vi.fn();
    render(
      <CommandPalette
        open
        commands={[
          {
            id: "file.rename",
            title: "Rename current file",
            description: "Rename the active file.",
            category: "File",
            run,
          },
        ]}
        onLoadFiles={async () => batch}
        onOpenFile={vi.fn()}
        onCommandError={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.keyDown(
      await screen.findByRole("combobox", {
        name: "Search commands or filenames across vaults",
      }),
      { key: "Enter", isComposing: true },
    );

    expect(run).not.toHaveBeenCalled();
  });

  it("preserves Home and End for editing the query", async () => {
    render(
      <CommandPalette
        open
        commands={commands}
        onLoadFiles={async () => batch}
        onOpenFile={vi.fn()}
        onCommandError={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = await screen.findByRole("combobox", {
      name: "Search commands or filenames across vaults",
    });

    expect(fireEvent.keyDown(input, { key: "Home" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "End" })).toBe(true);
  });
});
