import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
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

  it("renders repeated Markdown tags as chips with one shared vault color", async () => {
    const editorRef = createRef<MDXEditorMethods>();
    render(
      <MarkdownEditor
        ref={editorRef}
        notePath="note.md"
        markdown="Read #guide, then revisit #guide."
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        tagColors={{ guide: "#7aa66a" }}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const tags = await screen.findAllByText("#guide");
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toHaveClass("denote-inline-tag");
      expect(tag).toHaveStyle("--tag-color: #7aa66a");
    }
    expect(tags[0].closest(".denote-editor-root")).toHaveClass(
      "mdxeditor-full-height",
    );
    expect(editorRef.current?.getMarkdown()).toBe(
      "Read #guide, then revisit #guide.",
    );
  });

  it("keeps a line-leading tag intact after an unrelated rich-text edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"#guide\n\nSecond"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={onChange}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const paragraph = await screen.findByText("Second");
    await user.click(paragraph);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    await user.keyboard("!");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const changed = onChange.mock.lastCall?.[0] as string;
    expect(changed).toMatch(/^#guide(?:\n|$)/);
    expect(changed).not.toMatch(/^\\#guide/);
  });
});
