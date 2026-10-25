import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import { fromMarkdown } from "mdast-util-from-markdown";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { MarkdownEditor } from "./MarkdownEditor";

function renderSyntheticEditor(markdown: string, onChange = vi.fn()) {
  return render(
    <MarkdownEditor
      notePath="synthetic.md"
      markdown={markdown}
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
}

vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { ...actual, fromMarkdown: vi.fn(actual.fromMarkdown) };
});

describe("MarkdownEditor typing work", () => {
  it("shares the opening parse with reference, TOC, and thematic-break snapshots", async () => {
    const source = [
      "---",
      "title: Synthetic document",
      "---",
      "",
      "# Synthetic document",
      "",
      "<!-- toc -->",
      "- [Synthetic document](#synthetic-document)",
      "<!-- /toc -->",
      "",
      "Read [the guide][guide].\n\n".repeat(100),
      "[guide]: https://example.test/guide",
    ].join("\n");
    vi.mocked(fromMarkdown).mockClear();
    renderSyntheticEditor(source);
    await screen.findByRole("textbox", { name: "editable markdown" });
    await act(async () => {});

    expect(
      vi.mocked(fromMarkdown).mock.calls.filter(([value]) => value === source),
      "Opening should not parse the original document again for independent snapshots",
    ).toHaveLength(1);
  });

  it("does not rescan unrelated presentation across the entire page for ordinary text", async () => {
    const changed = vi.fn();
    renderSyntheticEditor(
      "# Synthetic heading\n\n" +
        "Ordinary synthetic paragraph.\n\n".repeat(100) +
        "Edit here",
      changed,
    );
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    await act(async () => {});
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    const queries = vi.spyOn(Element.prototype, "querySelectorAll");
    try {
      act(() => {
        editor.update(() => {
          $getRoot().getLastDescendant()?.selectEnd();
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) throw new Error("Expected a synthetic caret");
          selection.insertText("x");
        }, { discrete: true });
      });
      await waitFor(() => expect(changed).toHaveBeenCalled());
      await act(async () => {});
      const wholePageScans = queries.mock.calls.filter(([selector]) =>
        selector.includes(".denote-editor-content h1") ||
        selector === ".denote-hashtag" ||
        selector === "[data-denote-generated-toc]" ||
        selector === 'img[width="inherit"], img[height="inherit"]',
      );
      expect(wholePageScans).toEqual([]);
      expect(changed.mock.lastCall?.[0]).toContain("Edit herex");
      expect(screen.getByRole("heading", { name: "Synthetic heading" }).id)
        .toBe("synthetic-heading");
    } finally {
      queries.mockRestore();
    }
  });

  it.each(
    (["rich-text", "source"] as const).flatMap((mode) =>
      (["inline", "reference", "toc"] as const).map((kind) => ({ mode, kind })),
    ),
  )(
    "bounds whole-note work for $kind links on each $mode keystroke",
    async ({ mode, kind }) => {
      const changed = vi.fn();
      const link = kind === "inline"
        ? "[the guide](https://example.test/guide)"
        : "[the guide][guide]";
      const definitions = kind !== "inline"
        ? "[guide]: https://example.test/guide\n\n"
        : "";
      const source =
        (kind === "toc"
          ? "---\ntitle: Synthetic document\n---\n\n" +
            "<!-- toc -->\n- [Synthetic document](#synthetic-document)\n<!-- /toc -->\n\n"
          : "") +
        "# Synthetic document\n\n" +
        `Read ${link} and keep writing.\n\n`.repeat(100) +
        definitions +
        "Edit here";
      function Editor() {
        const [markdown, setMarkdown] = useState(source);
        return (
          <MarkdownEditor
            notePath="synthetic.md"
            markdown={markdown}
            lineEnding="lf"
            displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
            preferredViewMode={mode}
            readOnly={false}
            onChange={(value) => {
              setMarkdown(value);
              changed(value);
            }}
            onError={vi.fn()}
            onLinkOpen={vi.fn()}
            onViewModeChange={vi.fn()}
            onImageUpload={vi.fn()}
          />
        );
      }
      const { container } = render(<Editor />);
      let type: () => void | Promise<void>;
      if (mode === "rich-text") {
        const root = await screen.findByRole("textbox", {
          name: "editable markdown",
        });

        const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor })
          .__lexicalEditor;
        type = () => {
          act(() => {
            editor.update(() => {
              $getRoot().getLastDescendant()?.selectEnd();
              const selection = $getSelection();
              if (!$isRangeSelection(selection)) {
                throw new Error("Expected a text caret in the synthetic document");
              }
              selection.insertText("x");
            }, { discrete: true });
          });
        };
      } else {
        const view = await waitFor(() => {
          const element = container.querySelector<HTMLElement>(".cm-editor");
          expect(element).not.toBeNull();
          return EditorView.findFromDOM(element!)!;
        });
        await act(async () => {});
        type = () => {
          act(() => {
            view.dispatch({
              changes: { from: view.state.doc.length, insert: "x" },
            });
          });
        };
      }
      vi.mocked(fromMarkdown).mockClear();

      await type();
      await waitFor(() => expect(changed).toHaveBeenCalled());
      await type();

      expect(changed.mock.lastCall?.[0]).toContain("Edit herexx");
      expect(changed.mock.lastCall?.[0]).toContain(link);
      if (definitions) expect(changed.mock.lastCall?.[0]).toContain(definitions);
      expect(changed.mock.lastCall?.[0].match(/keep writing/g)).toHaveLength(100);
      if (kind === "toc") {
        const fullParses = vi.mocked(fromMarkdown).mock.calls.filter(
          ([value]) => value.length > source.length / 2,
        );
        expect(fullParses.length).toBeLessThanOrEqual(4);
      } else {
        expect(fromMarkdown).not.toHaveBeenCalled();
      }
    },
  );
});
