import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor links", () => {
  it("routes an ordinary external-link click through the host opener", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown="[Example](https://example.com)"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={onLinkOpen}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("link", { name: "Example" }));

    expect(onLinkOpen).toHaveBeenCalledOnce();
    expect(onLinkOpen).toHaveBeenCalledWith(
      "https://example.com",
      "Example",
    );
  });

  it("keeps ordinary relative-link clicks available for editing", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown="[Plan](notes/plan.md)"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={onLinkOpen}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );
    const link = await screen.findByRole("link", { name: "Plan" });

    expect(fireEvent.click(link)).toBe(false);
    expect(onLinkOpen).not.toHaveBeenCalled();

    fireEvent.click(link, { metaKey: true });
    expect(onLinkOpen).toHaveBeenCalledWith("notes/plan.md", "Plan");
  });

  it("reports source-mode preference changes", async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown="# Note"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={onViewModeChange}
        onImageUpload={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("radio", { name: "Source mode" }),
    );

    expect(onViewModeChange).toHaveBeenCalledWith("source");
  });

  it("does not overwrite the preference when display guides force source mode", async () => {
    const onViewModeChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown="# Note"
        lineEnding="lf"
        displaySettings={{
          ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
          showLineNumbers: true,
        }}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={onViewModeChange}
        onImageUpload={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Source guides enabled"),
    ).toBeInTheDocument();
    expect(onViewModeChange).not.toHaveBeenCalled();
  });
});
