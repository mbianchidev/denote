import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import userEvent from "@testing-library/user-event";
import { createRef, StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { api } from "../lib/api";
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

  it("routes ordinary relative-link clicks through vault navigation", async () => {
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
    expect(onLinkOpen).toHaveBeenCalledWith("notes/plan.md", "Plan");
  });

  it("preserves file anchors when routing internal links", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="Start.md"
        markdown={"[link](welcome.md#what-is-denote)"}
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

    fireEvent.click(await screen.findByRole("link", { name: "link" }));

    expect(onLinkOpen).toHaveBeenCalledWith(
      "welcome.md#what-is-denote",
      "link",
    );
  });

  it("recovers angle-bracket internal links with spaces", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="docs/Keyboard shortcuts.md"
        markdown="[Next: Optional plugins](<Optional plugins.md>)"
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

    fireEvent.click(
      await screen.findByRole("link", { name: "Next: Optional plugins" }),
    );

    expect(onLinkOpen).toHaveBeenCalledWith(
      "Optional plugins.md",
      "Next: Optional plugins",
    );
  });

  it("keeps directly entered angle-bracket Markdown links exact after rich edits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          "[Next: Writing and formatting](<Writing and formatting.md>)\n\nEdit"
        }
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

    expect(
      await screen.findByRole("link", {
        name: "Next: Writing and formatting",
      }),
    ).toBeInTheDocument();
    const paragraph = screen.getByText("Edit");
    await user.click(paragraph);
    placeCaretAtEnd(paragraph);
    await user.keyboard("!");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0]).toBe(
      "[Next: Writing and formatting](<Writing and formatting.md>)\n\n!",
    );
  });

  it("renders legacy internal links with bare spaces", async () => {
    const user = userEvent.setup();
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="docs/Keyboard shortcuts.md"
        markdown="[Next: Optional plugins](Optional plugins.md)"
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

    fireEvent.click(
      await screen.findByRole("link", { name: "Next: Optional plugins" }),
    );

    expect(onLinkOpen).toHaveBeenCalledWith(
      "Optional plugins.md",
      "Next: Optional plugins",
    );
    await user.click(screen.getByRole("radio", { name: "Source mode" }));
    await waitFor(() =>
      expect(
        EditorView.findFromDOM(
          document.querySelector<HTMLElement>(
            ".mdxeditor-source-editor .cm-editor",
          )!,
        )?.state.doc.toString(),
      ).toContain("(<Optional plugins.md>)"),
    );
    await user.click(screen.getByRole("radio", { name: "Rich text" }));
    expect(
      await screen.findByRole("link", { name: "Next: Optional plugins" }),
    ).toBeInTheDocument();
  });

  it("preserves selected rich text when opening the link dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown="Example text"
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
    const paragraph = await screen.findByText("Example text");
    const contentEditable = paragraph.closest<HTMLElement>(
      '[contenteditable="true"]',
    );
    expect(contentEditable).not.toBeNull();
    contentEditable!.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Text, 0);
    range.setEnd(paragraph.firstChild as Text, 7);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    const createLink = screen.getByRole("button", { name: "Create link" });
    fireEvent.pointerDown(createLink);
    await user.click(createLink);
    const urlInput = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[name="url"]',
      );
      expect(input).not.toBeNull();
      return input!;
    });
    await user.type(urlInput, "https://example.com");
    await user.click(screen.getByRole("button", { name: "Set URL" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("[Example](https://example.com) text"),
      ),
    );
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

  it("preserves user-authored angle escapes in source mode", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"\\<kbd>\n\nEdit"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="source"
        readOnly={false}
        onChange={onChange}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return element!;
    });
    const view = EditorView.findFromDOM(editorElement)!;
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "!" },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toContain(
      "\\<kbd>",
    );
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
      await screen.findByText("Guides lock source mode"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Rich text mode unavailable while display guides are enabled",
      }),
    ).toBeDisabled();
    expect(
      screen.getByTitle(
        "Disable line numbers and invisible-character guides to switch editor modes.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("note", {
        name: "Disable line numbers and invisible-character guides to switch editor modes.",
      }),
    ).toHaveAttribute("tabindex", "0");
    expect(onViewModeChange).not.toHaveBeenCalled();
  });

  it("highlights and focuses a located source error", async () => {
    const markdown = "# Heading\n\nproblem";
    const props = {
      notePath: "broken.md",
      markdown,
      lineEnding: "lf" as const,
      displaySettings: {
        ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
        showLineNumbers: true,
      },
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      errorLocation: { line: 3, column: 2 },
      tagColors: {},
      onChange: vi.fn(),
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange: vi.fn(),
      onImageUpload: vi.fn(),
    };
    const { container, rerender } = render(
      <MarkdownEditor {...props} errorNavigationRequest={0} />,
    );

    await waitFor(() =>
      expect(container.querySelector(".cm-diagnostic-line")).toHaveTextContent(
        "problem",
      ),
    );
    rerender(<MarkdownEditor {...props} errorNavigationRequest={1} />);
    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return element!;
    });
    const view = EditorView.findFromDOM(editorElement);
    await waitFor(() => expect(view?.hasFocus).toBe(true));
    const line = view!.state.doc.line(3);
    expect(view!.state.selection.main.head).toBe(line.from + 1);
  });

  it("renders standard Markdown angle text without MDX parser errors", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onMarkdownError = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="mock-note.md"
        markdown={
          "Mock threshold <42 units\n\nMarker <7\n\nToken <mock-key or example sample.invalid>\n\n**Use <mock-key> here**\n\nEdit me"
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={onChange}
        onError={vi.fn()}
        onMarkdownError={onMarkdownError}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const richContent = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        ".denote-editor-content",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(richContent).toHaveTextContent("Mock threshold <42 units");
    expect(richContent).toHaveTextContent("Marker <7");
    expect(richContent).toHaveTextContent(
      "Token <mock-key or example sample.invalid>",
    );
    expect(richContent.querySelector("strong")).toHaveTextContent(
      "Use <mock-key> here",
    );
    expect(
      screen.getByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(onMarkdownError).not.toHaveBeenCalled();

    const paragraph = screen.getByText("Edit me");
    await user.click(paragraph);
    await user.keyboard("!");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved =
      onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? "";
    expect(saved).toContain("<42");
    expect(saved).toContain("<mock-key");
  });

  it("keeps raw HTML images locked to lossless source mode", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown={'<img src="pic.png" alt="x" data-id="1">\n\nEdit me'}
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

    expect(
      await screen.findByText("Source-only Markdown syntax"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Rich text mode unavailable for source-only Markdown syntax",
      }),
    ).toBeDisabled();
    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return element!;
    });
    const view = EditorView.findFromDOM(editorElement)!;
    expect(view.state.doc.toString()).toContain(
      '<img src="pic.png" alt="x" data-id="1">',
    );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "!" },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved =
      onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? "";
    expect(saved).toContain('<img src="pic.png" alt="x" data-id="1">');
    expect(saved).not.toContain("![x]");
  });

  it("updates the source-only lock when Markdown content changes", async () => {
    const onViewModeChange = vi.fn();
    const props = {
      notePath: "note.md",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      onChange: vi.fn(),
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange,
      onImageUpload: vi.fn(),
    };
    const { rerender } = render(
      <MarkdownEditor {...props} markdown="# Note" />,
    );
    expect(
      await screen.findByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");

    rerender(<MarkdownEditor {...props} markdown={"# Note\n\nType <a"} />);
    expect(
      await screen.findByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");

    rerender(
      <MarkdownEditor
        {...props}
        markdown={'# Note\n\n<a href="https://example.com">'}
      />,
    );
    expect(
      await screen.findByRole("button", {
        name: "Rich text mode unavailable for source-only Markdown syntax",
      }),
    ).toBeDisabled();
    expect(onViewModeChange).not.toHaveBeenCalled();

    rerender(<MarkdownEditor {...props} markdown="# Note" />);
    expect(
      await screen.findByRole("radio", { name: "Rich text" }),
    ).toBeInTheDocument();
  });

  it("adds stable IDs to rendered headings for anchor navigation", async () => {
    class ImmediateImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", ImmediateImage);
    try {
      render(
        <MarkdownEditor
          notePath="note.md"
          markdown={
            "# What is Denote?\n\n## What is Denote?\n\n### ![Diagram](https://example.com/anchor-diagram.png)"
          }
          lineEnding="lf"
          displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
          preferredViewMode="rich-text"
          readOnly={false}
          onChange={vi.fn()}
          onError={vi.fn()}
          onLinkOpen={vi.fn()}
          onViewModeChange={vi.fn()}
          onImageUpload={vi.fn()}
        />,
      );

      expect(await screen.findByRole("heading", { level: 1 })).toHaveAttribute(
        "id",
        "what-is-denote",
      );
      expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute(
        "id",
        "what-is-denote-1",
      );
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute(
          "id",
          "diagram",
        ),
      );
      screen
        .getByRole("img", { name: "Diagram" })
        .setAttribute("alt", "Updated diagram");
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute(
          "id",
          "updated-diagram",
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("anchors nested rendered headings without shifting later IDs", async () => {
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"> # Quoted\n\n# Normal"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings[0]).toHaveAttribute("id", "quoted");
    expect(headings[1]).toHaveAttribute("id", "normal");
  });

  it("renders and preserves comment-delimited table of contents blocks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          "<!-- toc -->\n- [Mock overview](#-mock-overview)\n- [Sample details](#-sample-details)\n<!-- /toc -->\n\n# ⚡ Mock overview\n\n# 🧪 Sample details\n\nEdit me"
        }
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

    expect(
      await screen.findByRole("link", { name: "Mock overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sample details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");
    const paragraph = screen.getByText("Edit me");
    await user.click(paragraph);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    await user.keyboard("x");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("<!-- toc -->"),
      ),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining("<!-- /toc -->"),
    );
    await user.click(screen.getByRole("radio", { name: "Source mode" }));
    const sourceEditor = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        ".mdxeditor-source-editor .cm-editor",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    const sourceView = EditorView.findFromDOM(sourceEditor);
    expect(sourceView?.state.doc.toString()).toContain("<!-- toc -->");
    expect(sourceView?.state.doc.toString()).toContain("<!-- /toc -->");
    expect(sourceView ? undo(sourceView) : true).toBe(false);
  });

  it("renders indented generated TOCs and thematic breaks in rich mode", async () => {
    const { container } = render(
      <MarkdownEditor
        notePath="mock-handbook.md"
        markdown={
          "<!-- toc -->\n  - [Mock overview](#-mock-overview)\n  - [Synthetic setup](#-synthetic-setup)\n  - [Sample details](#-sample-details)\n<!-- /toc -->\n\n---\n\n# ⚡ Mock overview\n\n## 🧪 Synthetic setup\n\n## 📋 Sample details"
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("link", { name: "Mock overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Synthetic setup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sample details" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("list", { name: "Table of contents" }),
    ).toHaveClass("denote-generated-toc");
    expect(
      container.querySelector(".denote-editor-content hr"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("renders a standalone triple dash as a separator, not frontmatter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"Before\n\n---\n\nAfter"}
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

    expect(
      await waitFor(() =>
        container.querySelector(".denote-editor-content hr"),
      ),
    ).toBeInTheDocument();
    const after = screen.getByText("After");
    await user.click(after);
    placeCaretAtEnd(after);
    await user.keyboard("!");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0]).toContain("\n\n---\n\n");
  });

  it("keeps paired leading triple dashes as frontmatter", async () => {
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"---\ntitle: Note\n---\n\nBody"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(await screen.findByText("Body")).toBeInTheDocument();
    expect(
      container.querySelector(".denote-editor-content hr"),
    ).not.toBeInTheDocument();
  });

  it("does not label ordinary items merged beside a generated TOC", async () => {
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n- ordinary\n\n# One"
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(await screen.findByRole("link", { name: "One" })).toBeInTheDocument();
    expect(screen.getByText("ordinary")).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Table of contents" }),
    ).not.toBeInTheDocument();
  });

  it("labels the document TOC instead of a matching quoted list", async () => {
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          "> - [One](#one)\n\n<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n\n# One"
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const toc = await screen.findByRole("list", {
      name: "Table of contents",
    });
    expect(toc.closest("blockquote")).toBeNull();
  });

  it("renders only a tag-only final content line as colored pills", async () => {
    const editorRef = createRef<MDXEditorMethods>();
    render(
      <MarkdownEditor
        ref={editorRef}
        notePath="note.md"
        markdown={
          "# Heading #topic\n\n<!-- toc -->\n- [Guide](#guide)\n<!-- /toc -->\n\nRead #topic inline.\n\n#guide #project/日本語"
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        tagColors={{ guide: "#7aa66a", "project/日本語": "#8f77bd" }}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const guide = await screen.findByText("#guide");
    const unicodePath = screen.getByText("#project/日本語");
    expect(guide).toHaveClass("denote-inline-tag");
    expect(guide).toHaveStyle("--tag-color: #7aa66a");
    expect(unicodePath).toHaveClass("denote-inline-tag");
    expect(unicodePath).toHaveStyle("--tag-color: #8f77bd");
    for (const ordinary of screen.getAllByText("#topic")) {
      expect(ordinary).not.toHaveClass("denote-inline-tag");
    }
    expect(
      screen.getByRole("link", { name: "Guide" }),
    ).not.toHaveClass("denote-inline-tag");
    expect(guide.closest(".denote-editor-root")).toHaveClass(
      "mdxeditor-full-height",
    );
    expect(editorRef.current?.getMarkdown()).toContain(
      "\\#guide #project/日本語",
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

  it("renders and serializes an empty fenced block as an empty code section", async () => {
    const editorRef = createRef<MDXEditorMethods>();
    render(
      <MarkdownEditor
        ref={editorRef}
        notePath="note.md"
        markdown={"```\n```"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Copy code block" }),
    ).toBeInTheDocument();
    expect(editorRef.current?.getMarkdown()).toBe("```\n```");
  });

  it("creates an empty code section when complete empty fences are pasted", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown=""
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
    const content = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '.denote-editor-content[contenteditable="true"]',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    content.focus();

    fireEvent.paste(content, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "```\n```" : ""),
      },
    });

    expect(
      await screen.findByRole("button", { name: "Copy code block" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("```\n```"),
    );
  });

  it("loads local Markdown images through the host image API", async () => {
    class ImmediateImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", ImmediateImage);
    const readImage = vi
      .spyOn(api, "readImageDataUrl")
      .mockResolvedValue("data:image/svg+xml;base64,PHN2Zy8+");
    try {
      render(
        <MarkdownEditor
          notePath="notes/orbits.md"
          markdown="![Orbiting note](assets/orbit.svg)"
          lineEnding="lf"
          displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
          preferredViewMode="rich-text"
          readOnly={false}
          onChange={vi.fn()}
          onError={vi.fn()}
          onLinkOpen={vi.fn()}
          onViewModeChange={vi.fn()}
          onImageUpload={vi.fn()}
        />,
      );

      expect(
        await screen.findByRole("img", { name: "Orbiting note" }),
      ).toHaveAttribute("src", "data:image/svg+xml;base64,PHN2Zy8+");
      expect(readImage).toHaveBeenCalledWith(
        "assets/orbit.svg",
        "notes/orbits.md",
      );
    } finally {
      readImage.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("surfaces local Markdown image loading failures", async () => {
    const failure = new Error("Image is outside the vault");
    const readImage = vi
      .spyOn(api, "readImageDataUrl")
      .mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <MarkdownEditor
        notePath="notes/orbits.md"
        markdown="![Orbiting note](assets/orbit.svg)"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={onError}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Image is outside the vault"),
    );
    readImage.mockRestore();
    consoleError.mockRestore();
  });

  it("uses one selected mode for every file in the vault", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ViewModeNavigationHarness />
      </StrictMode>,
    );

    await user.click(
      await screen.findByRole("radio", { name: "Source mode" }),
    );
    expect(screen.getByTestId("preferred-view-mode")).toHaveTextContent("source");

    await user.click(screen.getByRole("button", { name: "Open second file" }));
    expect(
      await screen.findByRole("radio", { name: "Source mode", checked: true }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open first file" }));
    expect(
      await screen.findByRole("radio", { name: "Source mode", checked: true }),
    ).toBeInTheDocument();

    await user.click(
      await screen.findByRole("radio", { name: "Rich text" }),
    );
    expect(screen.getByTestId("preferred-view-mode")).toHaveTextContent(
      "rich-text",
    );
    expect(
      await screen.findByRole("radio", {
        name: "Rich text",
        checked: true,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open second file" }));
    expect(
      await screen.findByRole("radio", {
        name: "Rich text",
        checked: true,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open first file" }));
    expect(
      await screen.findByRole("radio", {
        name: "Rich text",
        checked: true,
      }),
    ).toBeInTheDocument();
  });

  it("copies a rich code block from its inline button", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(api, "copyFileContent").mockResolvedValue();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"```js\nconst answer = 42;\n```"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Copy code block" }),
    );

    expect(copy).toHaveBeenCalledWith("const answer = 42;");
    copy.mockRestore();
  });
});

function ViewModeNavigationHarness() {
  const [path, setPath] = useState("one.md");
  const [mode, setMode] = useState<"rich-text" | "source">("rich-text");
  return (
    <>
      <button type="button" onClick={() => setPath("one.md")}>
        Open first file
      </button>
      <button type="button" onClick={() => setPath("two.md")}>
        Open second file
      </button>
      <output data-testid="preferred-view-mode">{mode}</output>
      <MarkdownEditor
        key={path}
        notePath={path}
        markdown={`# ${path}`}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode={mode}
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={setMode}
        onImageUpload={vi.fn()}
      />
    </>
  );
}

function placeCaretAtEnd(element: Element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
