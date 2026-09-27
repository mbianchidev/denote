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
import type { MarkdownViewMode } from "../lib/markdownView";
import { MarkdownEditor } from "./MarkdownEditor";

vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { ...actual, fromMarkdown: vi.fn(actual.fromMarkdown) };
});

describe("MarkdownEditor typing work", () => {
  it.each<MarkdownViewMode>(["rich-text", "source"])(
    "does not reparse a linked document for each %s keystroke",
    async (mode) => {
      const changed = vi.fn();
      const source =
        "# Synthetic document\n\n" +
        "Read [the guide](https://example.test/guide) and keep writing.\n\n".repeat(100) +
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

      expect(changed.mock.lastCall?.[0]).toContain("Edit herex");
      expect(changed.mock.lastCall?.[0]).toContain(
        "[the guide](https://example.test/guide)",
      );
      expect(fromMarkdown).not.toHaveBeenCalled();
    },
  );
});
