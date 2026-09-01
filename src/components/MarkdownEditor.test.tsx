import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import userEvent from "@testing-library/user-event";
import { createRef, StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { api } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor links", () => {
  it("renders full, collapsed, and shortcut references without processing errors", async () => {
    const onMarkdownError = vi.fn();
    const onLinkOpen = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          '[Guide text][guide-home]\n\n[Guide text][]\n\n[guide-home]\n\n[guide-home]: https://docs.example.test/guide "Optional title"\n[guide text]: notes/start.md'
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onMarkdownError={onMarkdownError}
        onLinkOpen={onLinkOpen}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Guide text",
      "Guide text",
      "guide-home",
    ]);
    fireEvent.click(links[0]);
    expect(onLinkOpen).toHaveBeenCalledWith(
      "https://docs.example.test/guide",
      "Guide text",
    );
    expect(links[1]).toHaveAttribute("href", "notes/start.md");
    fireEvent.click(links[1]);
    expect(onLinkOpen).toHaveBeenCalledWith("notes/start.md", "Guide text");
    expect(
      container.querySelectorAll("[data-denote-reference-definition]"),
    ).toHaveLength(1);
    expect(onMarkdownError).not.toHaveBeenCalled();
    expect(
      screen.getByRole("radio", { name: "Rich text", checked: true }),
    ).toBeInTheDocument();
  });

  it("uses the first duplicate definition and keeps unused definitions invisible", async () => {
    const onLinkOpen = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          "[Read][topic]\n\n[topic]: https://first.example.test/page\n[TOPIC]: https://second.example.test/page\n[unused]: notes/hidden.md"
        }
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

    fireEvent.click(await screen.findByRole("link", { name: "Read" }));
    expect(onLinkOpen).toHaveBeenCalledWith(
      "https://first.example.test/page",
      "Read",
    );
    expect(screen.queryByText("notes/hidden.md")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-denote-reference-definition]"),
    ).toHaveLength(1);
  });

  it("preserves exact definitions after an unrelated rich edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const first =
      "  [guide-home]:  <https://docs.example.test/guide>  'Optional title'";
    const second =
      '[repo-card]: <copilot-ref kind="repo" target-id="https://example.test/acme/widget" label="acme/widget" />';
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={`[Guide][guide-home]\n\n${first}\n${second}\n\nEdit here`}
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

    const paragraph = await screen.findByText("Edit here");
    await user.click(paragraph);
    placeCaretAtEnd(paragraph);
    await user.keyboard("!");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const output = onChange.mock.lastCall?.[0] as string;
    expect(output).toContain(first);
    expect(output).toContain(second);
    expect(output.indexOf(first)).toBeLessThan(output.indexOf(second));
  });

  it.each([
    {
      name: "LF with no blank line",
      definitions: "  [one]:  /one\n[Two]: <notes/two.md>",
    },
    {
      name: "LF with one blank line",
      definitions: "[one]: /one\n\n   [two]:  /two",
    },
    {
      name: "CRLF with no blank line",
      definitions: "   [one]: /one\r\n[two]:  <notes/two.md>",
    },
    {
      name: "CRLF with one blank line",
      definitions: "[one]:  /one\r\n\r\n  [two]: /two",
    },
  ])("preserves consecutive definition spacing exactly: $name", async ({
    definitions,
  }) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={`[Read][one]\n\n${definitions}\n\nEdit here`}
        lineEnding={definitions.includes("\r\n") ? "crlf" : "lf"}
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

    const paragraph = await screen.findByText("Edit here");
    await user.click(paragraph);
    placeCaretAtEnd(paragraph);
    await user.keyboard("!");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0]).toContain(definitions);
  });

  it("keeps content-separated definition groups in their relative positions", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const firstGroup = "[one]: /one\n[two]: /two";
    const secondGroup = "  [three]: /three\n\n[FOUR]: /four";
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={`[Read][one]\n\n${firstGroup}\n\nMiddle content\n\n${secondGroup}\n\nEdit here`}
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

    const paragraph = await screen.findByText("Edit here");
    await user.click(paragraph);
    placeCaretAtEnd(paragraph);
    await user.keyboard("!");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const output = onChange.mock.lastCall?.[0] as string;
    expect(output).toContain(firstGroup);
    expect(output).toContain(secondGroup);
    expect(output.indexOf(firstGroup)).toBeLessThan(
      output.indexOf("Middle content"),
    );
    expect(output.indexOf("Middle content")).toBeLessThan(
      output.indexOf(secondGroup),
    );
  });

  it("resolves strict generated repository definitions through normal link interception", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          '[Open repository][repo-card]\n\n[repo-card]: <copilot-ref kind="repo" target-id="https://example.test/acme/widget" label="acme/widget" />'
        }
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
      await screen.findByRole("link", { name: "Open repository" }),
    );
    expect(onLinkOpen).toHaveBeenCalledWith(
      "https://example.test/acme/widget",
      "Open repository",
    );
  });

  it("routes custom-scheme reference destinations through Denote interception", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"[Open app][target]\n\n[target]: sample-app://open/item"}
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

    const link = await screen.findByRole("link", { name: "Open app" });
    expect(link).toHaveAttribute("href", "about:blank");
    fireEvent.click(link);
    expect(onLinkOpen).toHaveBeenCalledWith(
      "sample-app://open/item",
      "Open app",
    );
  });

  it("keeps invalid generated and unresolved references literal and source-safe", async () => {
    const onMarkdownError = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={
          '[Unsafe][repo-card]\n\n[Missing][unknown]\n\n[repo-card]: <copilot-ref kind="repo" target-id="javascript:alert(1)" label="acme/widget" />'
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onMarkdownError={onMarkdownError}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(await screen.findByText("[Unsafe][repo-card]")).toBeInTheDocument();
    expect(screen.getByText("[Missing][unknown]")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(onMarkdownError).not.toHaveBeenCalled();
  });

  it("neutralizes unsafe ordinary reference destinations", async () => {
    const onLinkOpen = vi.fn();
    render(
      <MarkdownEditor
        notePath="note.md"
        markdown={"[Unsafe][target]\n\n[target]: javascript:alert(1)"}
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

    const link = await screen.findByRole("link", { name: "Unsafe" });
    expect(link).toHaveAttribute("href", "about:blank");
    fireEvent.click(link);
    expect(onLinkOpen).toHaveBeenCalledWith("about:blank", "Unsafe");
  });

  it("treats source-mode definition edits as authoritative for later rich rendering", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = {
      notePath: "note.md",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      onChange,
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange: vi.fn(),
      onImageUpload: vi.fn(),
    };
    const { container, rerender } = render(
      <MarkdownEditor
        {...props}
        markdown={"[Guide][guide]\n\n[guide]: https://old.example.test/path"}
      />,
    );
    await screen.findByRole("link", { name: "Guide" });
    await user.click(screen.getByRole("radio", { name: "Source mode" }));
    const sourceElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return element!;
    });
    const sourceView = EditorView.findFromDOM(sourceElement)!;
    const updated =
      '[Guide][guide]\n\n[guide]:  <https://new.example.test/path>  "New title"';
    sourceView.dispatch({
      changes: { from: 0, to: sourceView.state.doc.length, insert: updated },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));

    rerender(<MarkdownEditor {...props} markdown={updated} />);
    await user.click(screen.getByRole("radio", { name: "Rich text" }));
    fireEvent.click(await screen.findByRole("link", { name: "Guide" }));
    expect(props.onLinkOpen).toHaveBeenCalledWith(
      "https://new.example.test/path",
      "Guide",
    );

    const paragraph = screen.getByText("Guide").closest("p")!;
    await user.click(paragraph);
    placeCaretAtEnd(paragraph);
    await user.keyboard("!");
    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0]).toContain(
        '[guide]:  <https://new.example.test/path>  "New title"',
      ),
    );
  });

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

  it("transiently enforces project source mode and restores saved preferences", async () => {
    const onChange = vi.fn();
    const onViewModeChange = vi.fn();
    const props = {
      notePath: "code/guide.md",
      lineEnding: "lf" as const,
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      onChange,
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange,
      onImageUpload: vi.fn(),
    };
    const { container, rerender } = render(
      <StrictMode>
        <MarkdownEditor
          {...props}
          markdown="# Workspace guide"
          displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
          projectSourceMode={false}
        />
      </StrictMode>,
    );
    expect(
      await screen.findByRole("radio", {
        name: "Rich text",
        checked: true,
      }),
    ).toBeInTheDocument();

    rerender(
      <StrictMode>
        <MarkdownEditor
          {...props}
          markdown="# Workspace guide"
          displaySettings={{
            ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
            showLineNumbers: true,
          }}
          projectSourceMode
        />
      </StrictMode>,
    );

    expect(
      await screen.findByText("Code workspace source mode"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Rich text mode unavailable inside a code workspace",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("note", {
        name: "Rich text mode is unavailable because this file is inside a code workspace.",
      }),
    ).toHaveAttribute("tabindex", "0");
    const sourceEditor = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return EditorView.findFromDOM(element!)!;
    });
    sourceEditor.dispatch({
      changes: {
        from: sourceEditor.state.doc.length,
        insert: "\n\nKept content",
      },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updatedMarkdown = onChange.mock.lastCall?.[0] ?? "";

    rerender(
      <StrictMode>
        <MarkdownEditor
          {...props}
          markdown={updatedMarkdown}
          displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
          projectSourceMode={false}
        />
      </StrictMode>,
    );

    expect(
      await screen.findByRole("radio", {
        name: "Rich text",
        checked: true,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Kept content")).toBeInTheDocument();
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
    expect(onViewModeChange).not.toHaveBeenCalled();
  });

  it("uses unique guidance ids across pane editor instances", async () => {
    const props = {
      markdown: "# Note",
      lineEnding: "lf" as const,
      displaySettings: {
        ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
        showLineNumbers: true,
      },
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      onChange: vi.fn(),
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange: vi.fn(),
      onImageUpload: vi.fn(),
    };
    render(
      <>
        <MarkdownEditor {...props} notePath="first.md" />
        <MarkdownEditor {...props} notePath="second.md" />
      </>,
    );

    const richButtons = await screen.findAllByRole("button", {
      name: "Rich text mode unavailable while display guides are enabled",
    });
    const guidanceIds = richButtons.map((button) =>
      button.getAttribute("aria-describedby"),
    );

    expect(new Set(guidanceIds).size).toBe(2);
    for (const guidanceId of guidanceIds) {
      expect(guidanceId).not.toBeNull();
      expect(document.getElementById(guidanceId as string)).toHaveTextContent(
        "Disable line numbers and invisible-character guides to switch editor modes.",
      );
    }
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

  it("focuses and selects a requested rich-text search match", async () => {
    render(
      <MarkdownEditor
        notePath="searchable.md"
        markdown="Start needle finish"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        searchNavigation={{
          request: 1,
          from: 6,
          to: 12,
          text: "needle",
        }}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    const content = await screen.findByText("Start needle finish");
    const contentEditable = content.closest<HTMLElement>(
      '[contenteditable="true"]',
    );
    await waitFor(() => expect(contentEditable).toHaveFocus());
    expect(window.getSelection()?.toString()).toBe("needle");
    expect(contentEditable).not.toHaveAttribute("tabindex", "-1");
  });

  it("switches to source mode for a match hidden by Markdown syntax", async () => {
    const onViewModeChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="searchable.md"
        markdown={"[label](needle)\n\nneedle"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        searchNavigation={{
          request: 1,
          from: 8,
          to: 14,
          text: "needle",
        }}
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={onViewModeChange}
        onImageUpload={vi.fn()}
      />,
    );

    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return element!;
    });
    const view = EditorView.findFromDOM(editorElement)!;
    await waitFor(() =>
      expect(
        view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        ),
      ).toBe("needle"),
    );
    expect(view.state.selection.main.from).toBe(8);
    expect(onViewModeChange).not.toHaveBeenCalledWith("source");
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

  it("renders details and summary elements with Markdown content", async () => {
    const editorRef = createRef<MDXEditorMethods>();
    const { container } = render(
      <MarkdownEditor
        ref={editorRef}
        notePath="details.md"
        markdown={
          "<details>\n<summary>More information</summary>\n\nHidden **Markdown** content.\n\n</details>"
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

    const details = await waitFor(() => {
      const element = container.querySelector("details");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(details.querySelector("summary")).toHaveTextContent(
      "More information",
    );
    expect(details.firstElementChild?.tagName).toBe("SUMMARY");
    await userEvent.click(details.querySelector("summary")!);
    expect(details).toHaveAttribute("open");
    expect(details.querySelector("strong")).toHaveTextContent("Markdown");
    expect(
      screen.getByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(editorRef.current?.getMarkdown()).toContain("<details>");
    expect(editorRef.current?.getMarkdown()).toContain("<summary>");
  });

  it("keeps serialized details in rich mode after a controlled update", async () => {
    const props = {
      notePath: "details.md",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      onChange: vi.fn(),
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange: vi.fn(),
      onImageUpload: vi.fn(),
    };
    const { container, rerender } = render(
      <MarkdownEditor
        {...props}
        markdown={
          "<details>\n<summary>More information</summary>\n\nHidden **Markdown**.\n\n</details>"
        }
      />,
    );

    rerender(
      <MarkdownEditor
        {...props}
        markdown={
          "<details>\n  <summary>\n    More information\n  </summary>\n\n  Hidden **Markdown**.\n</details>"
        }
      />,
    );

    await waitFor(() =>
      expect(container.querySelector("details")).not.toBeNull(),
    );
    expect(
      screen.getByRole("radio", { name: "Rich text" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("reinitializes HTML support when details are added", async () => {
    const user = userEvent.setup();
    const props = {
      notePath: "details.md",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      preferredViewMode: "rich-text" as const,
      readOnly: false,
      onChange: vi.fn(),
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange: vi.fn(),
      onImageUpload: vi.fn(),
    };
    const { container, rerender } = render(
      <MarkdownEditor {...props} markdown="Plain text" />,
    );

    await user.click(
      await screen.findByRole("radio", { name: "Source mode" }),
    );
    const sourceEditor = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      expect(element).not.toBeNull();
      return element!;
    });
    const sourceView = EditorView.findFromDOM(sourceEditor)!;
    sourceView.focus();
    rerender(
      <MarkdownEditor
        {...props}
        markdown={
          "<details>\n<summary>New disclosure</summary>\n\nHidden.\n\n</details>"
        }
      />,
    );

    expect(
      await screen.findByRole("radio", { name: "Source mode" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector(".cm-editor")).toBe(sourceEditor);
    expect(sourceView.hasFocus).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Rich text" }));
    await waitFor(() =>
      expect(container.querySelector("details")).not.toBeNull(),
    );
  });

  it("keeps mixed details and unsupported HTML syntax in source mode", async () => {
    const onMarkdownError = vi.fn();
    render(
      <MarkdownEditor
        notePath="mixed-details.md"
        markdown={
          "<details>\n<summary>Links</summary>\n\n<https://example.com>\n\n</details>"
        }
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        onChange={vi.fn()}
        onError={vi.fn()}
        onMarkdownError={onMarkdownError}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: "Source mode locked for source-only Markdown syntax",
      }),
    ).toBeInTheDocument();
    expect(onMarkdownError).not.toHaveBeenCalled();
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

  it("renders safe README HTML with intercepted links, native images, and adjacent directives", async () => {
    const readImage = vi
      .spyOn(api, "readImageDataUrl")
      .mockResolvedValue("data:image/svg+xml;base64,PHN2Zy8+");
    const onLinkOpen = vi.fn();
    try {
      const { container } = render(
        <MarkdownEditor
          notePath="notes/project.md"
          markdown={
            '<p align="center">\n  <a href="guides/start.md">Read <strong>the guide</strong></a>\n  <img src="assets/leaf.svg" alt="Project leaf" width="64" height="64" />\n  <img src="https://badges.example.test/check.svg" alt="Checks passing" />\n</p>\n\n:::caution\nKeep a local copy.\n:::'
          }
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

      const link = await screen.findByRole("link", { name: "Read the guide" });
      fireEvent.click(link);
      expect(onLinkOpen).toHaveBeenCalledWith(
        "guides/start.md",
        "Read the guide",
      );
      expect(link.querySelector("strong")).toHaveTextContent("the guide");
      expect(
        container.querySelector(".safe-rich-html__block"),
      ).toHaveStyle({ textAlign: "center" });
      const localImage = await screen.findByRole("img", {
        name: "Project leaf",
      });
      expect(localImage).toHaveAttribute(
        "src",
        "data:image/svg+xml;base64,PHN2Zy8+",
      );
      expect(localImage).toHaveAttribute("width", "64");
      expect(localImage).toHaveAttribute("height", "64");
      const remoteImage = screen.getByRole("img", {
        name: "Checks passing",
      });
      expect(remoteImage).toHaveAttribute(
        "src",
        "https://badges.example.test/check.svg",
      );
      expect(remoteImage).toHaveAttribute("loading", "lazy");
      expect(remoteImage).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(await screen.findByText("Keep a local copy.")).toBeInTheDocument();
      expect(readImage).toHaveBeenCalledWith(
        "assets/leaf.svg",
        "notes/project.md",
      );
    } finally {
      readImage.mockRestore();
    }
  });

  it("renders a safe standalone HTML screenshot", async () => {
    render(
      <MarkdownEditor
        notePath="docs/overview.md"
        markdown={
          '<img src="https://images.example.test/overview.png" alt="Example overview" width="900" height="540" />'
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
      await screen.findByRole("img", { name: "Example overview" }),
    ).toHaveAttribute("src", "https://images.example.test/overview.png");
  });

  it("preserves safe HTML bytes after an unrelated rich edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const raw =
      '<h2 align="right"><a href="notes/roadmap.md">Read <strong>next</strong></a></h2>';
    render(
      <MarkdownEditor
        notePath="notes/project.md"
        markdown={`${raw}\n\nEdit here`}
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

    const paragraph = await screen.findByText("Edit here");
    await user.click(paragraph);
    placeCaretAtEnd(paragraph);
    await user.keyboard("!");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0]).toContain(raw);
    expect(
      onChange.mock.lastCall?.[0].slice(
        onChange.mock.lastCall?.[0].indexOf("<h2"),
        onChange.mock.lastCall?.[0].indexOf("</h2>") + "</h2>".length,
      ),
    ).toBe(raw);
  });

  it("keeps unsafe and mixed-details HTML out of the rich DOM", async () => {
    const { container, rerender } = render(
      <MarkdownEditor
        notePath="notes/project.md"
        markdown={'<p><img src="data:image/png;base64,AA==" alt="Unsafe" /></p>'}
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
      await screen.findByText("Source-only Markdown syntax"),
    ).toBeInTheDocument();
    expect(container.querySelector(".safe-rich-html")).toBeNull();
    expect(screen.queryByRole("img", { name: "Unsafe" })).toBeNull();

    rerender(
      <MarkdownEditor
        notePath="notes/project.md"
        markdown={
          '<details>\n<summary>More</summary>\n\nHidden.\n\n</details>\n\n<p align="center">Visible</p>'
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
      await screen.findByText("Source-only Markdown syntax"),
    ).toBeInTheDocument();
    expect(container.querySelector(".safe-rich-html")).toBeNull();
  });

  it("surfaces safe local HTML image loading failures", async () => {
    const readImage = vi
      .spyOn(api, "readImageDataUrl")
      .mockRejectedValue(new Error("Image path was rejected"));
    const onError = vi.fn();
    try {
      render(
        <MarkdownEditor
          notePath="notes/project.md"
          markdown={
            '<p align="center"><img src="assets/missing.svg" alt="Missing mark" /></p>'
          }
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

      expect(
        await screen.findByText("Image unavailable: Missing mark"),
      ).toBeInTheDocument();
      expect(onError).toHaveBeenCalledWith("Image path was rejected");
      expect(readImage).toHaveBeenCalledWith(
        "assets/missing.svg",
        "notes/project.md",
      );
    } finally {
      readImage.mockRestore();
    }
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

      const image = await screen.findByRole("img", {
        name: "Orbiting note",
      });
      expect(image).toHaveAttribute(
        "src",
        "data:image/svg+xml;base64,PHN2Zy8+",
      );
      await waitFor(() => {
        expect(image).not.toHaveAttribute("width");
        expect(image).not.toHaveAttribute("height");
        expect(
          image.closest('[data-editor-block-type="image"]'),
        ).toHaveClass("denote-image-block");
      });
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

  it("preserves an unknown fence until an explicit language selection", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<MDXEditorMethods>();
    const onChange = vi.fn();
    const source =
      "# Synthetic\n\n```syntheticlang\nconst answer = 42;\n```\n\nTail";
    const { container } = render(
      <MarkdownEditor
        ref={editorRef}
        notePath="synthetic.md"
        markdown={source}
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

    const trigger = await screen.findByRole("button", {
      name: "Code block language: Unknown: syntheticlang",
    });
    expect(editorRef.current?.getMarkdown()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      EditorView.findFromDOM(
        container.querySelector<HTMLElement>(
          "[data-denote-code-block-editor] .cm-editor",
        )!,
      )?.state.doc.toString(),
    ).toBe("const answer = 42;");

    await user.click(trigger);
    await user.type(
      screen.getByRole("combobox", {
        name: "Search code block language",
      }),
      "python",
    );
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: "Python" }));

    await waitFor(() =>
      expect(editorRef.current?.getMarkdown()).toBe(
        "# Synthetic\n\n```python\nconst answer = 42;\n```\n\nTail",
      ),
    );
    expect(
      EditorView.findFromDOM(
        container.querySelector<HTMLElement>(
          "[data-denote-code-block-editor] .cm-editor",
        )!,
      )?.state.doc.toString(),
    ).toBe("const answer = 42;");

    await user.click(screen.getByRole("radio", { name: /Undo/ }));
    await waitFor(() =>
      expect(editorRef.current?.getMarkdown()).toBe(source),
    );
  });

  it("creates new fenced blocks with Automatic language", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<MDXEditorMethods>();
    render(
      <MarkdownEditor
        ref={editorRef}
        notePath="synthetic.md"
        markdown=""
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
      await screen.findByRole("button", { name: "Insert Code Block" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Code block language: Automatic",
      }),
    ).toBeInTheDocument();
    expect(editorRef.current?.getMarkdown()).toContain("```\n```");
  });

  it("keeps language and delete controls disabled in read mode", async () => {
    render(
      <MarkdownEditor
        notePath="synthetic.md"
        markdown={"```ts\nconst total = 3;\n```"}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly
        onChange={vi.fn()}
        onError={vi.fn()}
        onLinkOpen={vi.fn()}
        onViewModeChange={vi.fn()}
        onImageUpload={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: "Code block language: TypeScript",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete code block" }),
    ).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Read code block" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
  });

  it("updates the code block accessible label when read mode changes", async () => {
    const props = {
      notePath: "synthetic.md",
      markdown: "```ts\nconst total = 3;\n```",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      preferredViewMode: "rich-text" as const,
      onChange: vi.fn(),
      onError: vi.fn(),
      onLinkOpen: vi.fn(),
      onViewModeChange: vi.fn(),
      onImageUpload: vi.fn(),
    };
    const { container, rerender } = render(
      <MarkdownEditor {...props} readOnly={false} />,
    );
    const editable = await screen.findByRole("textbox", {
      name: "Edit code block",
    });
    const editorElement =
      container.querySelector<HTMLElement>(
        "[data-denote-code-block-editor] .cm-editor",
      )!;
    const view = EditorView.findFromDOM(editorElement);

    rerender(<MarkdownEditor {...props} readOnly />);

    expect(
      await screen.findByRole("textbox", { name: "Read code block" }),
    ).toBe(editable);
    expect(editable).toHaveAttribute("contenteditable", "false");
    expect(EditorView.findFromDOM(editorElement)).toBe(view);
  });

  it("copies a large live code document from the custom editor", async () => {
    const user = userEvent.setup();
    const code = Array.from(
      { length: 2_500 },
      (_, index) => `const value${index} = ${index};`,
    ).join("\n");
    const copy = vi.spyOn(api, "copyFileContent").mockResolvedValue();
    render(
      <MarkdownEditor
        notePath="large-synthetic.md"
        markdown={`\`\`\`js\n${code}\n\`\`\``}
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

    expect(copy).toHaveBeenCalledWith(code);
    copy.mockRestore();
  });

  it("updates fenced-code theme colors without remounting or changing history", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        notePath="theme-synthetic.md"
        markdown={"```ts\nconst total = 3;\n```"}
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
    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        "[data-denote-code-block-editor] .cm-editor",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    const view = EditorView.findFromDOM(editorElement)!;
    await vi.waitFor(() =>
      expect(syntaxTree(view.state).type.name).not.toBe(""),
    );
    view.dispatch({ selection: { anchor: 6, head: 11 } });

    applyTheme("light");

    expect(EditorView.findFromDOM(editorElement)).toBe(view);
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 11 });
    expect(view.state.doc.toString()).toBe("const total = 3;");
    expect(onChange).not.toHaveBeenCalled();
    applyTheme("dark");
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
