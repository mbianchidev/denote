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

vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { ...actual, fromMarkdown: vi.fn(actual.fromMarkdown) };
});

describe("MarkdownEditor typing work", () => {
  it.each(
    (["rich-text", "source"] as const).flatMap((mode) =>
      (["inline", "reference"] as const).map((kind) => ({ mode, kind })),
    ),
  )(
    "does not reparse $kind links for each $mode keystroke",
    async ({ mode, kind }) => {
      const changed = vi.fn();
      const link = kind === "inline"
        ? "[the guide](https://example.test/guide)"
        : "[the guide][guide]";
      const definitions = kind === "reference"
        ? "[guide]: https://example.test/guide\n\n"
        : "";
      const source =
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
      expect(fromMarkdown).not.toHaveBeenCalled();
    },
  );
});
