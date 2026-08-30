import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReplaceDialog } from "./ReplaceDialog";

describe("ReplaceDialog", () => {
  it("finds and applies selected replacements without closing", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockResolvedValue([
      {
        path: "note.md",
        occurrences: 2,
        originalContent: "note note",
        replacedContent: "document document",
        encoding: "utf8",
        lineEnding: "lf",
        beforeSnippet: "note note",
        afterSnippet: "document document",
      },
    ]);
    const onApply = vi.fn().mockResolvedValue({
      appliedFiles: 1,
      failedFiles: 0,
      replacedOccurrences: 2,
    });
    const onClose = vi.fn();

    render(
      <ReplaceDialog
        open
        currentPath="note.md"
        onClose={onClose}
        onPreview={onPreview}
        onApply={onApply}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Find" }), "note");
    await user.type(
      screen.getByRole("textbox", { name: "Replace with" }),
      "document",
    );
    await user.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByText("note.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByText("2 instances have been replaced."),
    ).toBeInTheDocument();
    expect(screen.queryByText("note.md")).not.toBeInTheDocument();
  });

  it("shows preview failures instead of reporting no matches", async () => {
    const user = userEvent.setup();
    render(
      <ReplaceDialog
        open
        currentPath={null}
        onClose={vi.fn()}
        onPreview={vi.fn().mockRejectedValue(new Error("Save conflict"))}
        onApply={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Find" }), "note");
    await user.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("Save conflict")).toBeInTheDocument();
    expect(screen.queryByText("No matches found.")).not.toBeInTheDocument();
  });
});
