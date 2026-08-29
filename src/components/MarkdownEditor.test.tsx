import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import userEvent from "@testing-library/user-event";
import { createRef, StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { api } from "../lib/api";
import {
  MarkdownEditor,
  type MarkdownEditorDiagnostic,
} from "./MarkdownEditor";

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

  it("reports and highlights the exact Markdown parser location", async () => {
    const onViewModeChange = vi.fn();
    const onMarkdownError = vi.fn();
    const onMarkdownErrorCleared = vi.fn();
    const editorRef = createRef<MDXEditorMethods>();

    function Harness() {
      const [diagnostic, setDiagnostic] =
        useState<MarkdownEditorDiagnostic | null>(null);
      return (
        <MarkdownEditor
          ref={editorRef}
          notePath="broken.md"
          markdown={"# Heading\n\n<1bad>"}
          lineEnding="lf"
          displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
          preferredViewMode="rich-text"
          readOnly={false}
          errorLocation={diagnostic?.location ?? undefined}
          onChange={vi.fn()}
          onError={vi.fn()}
          onMarkdownError={(nextDiagnostic) => {
            onMarkdownError(nextDiagnostic);
            setDiagnostic(nextDiagnostic);
          }}
          onMarkdownErrorCleared={onMarkdownErrorCleared}
          onLinkOpen={vi.fn()}
          onViewModeChange={onViewModeChange}
          onImageUpload={vi.fn()}
        />
      );
    }

    const { container } = render(<Harness />);

    await waitFor(() =>
      expect(onMarkdownError).toHaveBeenCalledWith(
        expect.objectContaining({
          location: { line: 3, column: 2 },
        }),
      ),
    );
    await waitFor(() =>
      expect(container.querySelector(".cm-diagnostic-line")).toHaveTextContent(
        "<1bad>",
      ),
    );
    expect(
      screen.getByRole("radio", { name: "Source mode" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(onViewModeChange).not.toHaveBeenCalled();

    act(() => editorRef.current?.setMarkdown("# Fixed"));
    await waitFor(() => expect(onMarkdownErrorCleared).toHaveBeenCalledOnce());
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
