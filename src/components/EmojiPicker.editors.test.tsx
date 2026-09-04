import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { language } from "@codemirror/language";
import { redo, undo } from "@codemirror/commands";
import { $getRoot, $getSelection, $isRangeSelection, KEY_DOWN_COMMAND, REDO_COMMAND, UNDO_COMMAND, type LexicalEditor } from "lexical";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { syntheticEmojiHost } from "../lib/emoji.testFixtures";
import { EmojiHostSurface, EmojiToolbar } from "./EmojiPicker";
import { PlainTextEditor } from "./PlainTextEditor";
import { MarkdownEditor } from "./MarkdownEditor";

function harness(mode: "plain" | "source" | "rich", initial: string, options: { readOnly?: boolean; path?: string; shortcodes?: string[]; unicode?: string } = {}) {
  const fixture = syntheticEmojiHost();
  if (options.shortcodes) fixture.picker.entries[0].shortcodes = options.shortcodes;
  if (options.unicode) fixture.picker.entries[0].unicode = options.unicode;
  const changed = vi.fn();
  let setEnabled = (_enabled: boolean) => {};
  function Harness() {
    const [value, setValue] = useState(initial);
    const [enabled, updateEnabled] = useState(true);
    setEnabled = updateEnabled;
    const change = (value: string) => { changed(value); setValue(value); };
    return <>
      <EmojiToolbar host={fixture.host} pickers={[fixture.picker]} />
      {mode === "plain" ? <PlainTextEditor
        ariaLabel="Synthetic source" value={value} readOnly={options.readOnly ?? false}
        spellCheck={false} binary={false} filePath={options.path ?? "synthetic.md"}
        markdownSource displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} lineEnding="lf"
        onChange={change} emoji={enabled ? fixture.binding : undefined}
      /> : <MarkdownEditor
        notePath={options.path ?? "synthetic.md"} markdown={value} readOnly={options.readOnly ?? false}
        preferredViewMode={mode === "source" ? "source" : "rich-text"}
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} lineEnding={initial.includes("\r\n") ? "crlf" : "lf"}
        onChange={change} onError={vi.fn()} onViewModeChange={vi.fn()} onLinkOpen={vi.fn()} onImageUpload={vi.fn()}
        emoji={enabled ? fixture.binding : undefined}
      />}
      <EmojiHostSurface host={fixture.host} />
    </>;
  }
  return { ...fixture, changed, ...render(<Harness />), setEnabled: (enabled: boolean) => {
    act(() => {
      fixture.host.configure({ ...fixture.config, pickers: enabled ? [fixture.picker] : [] });
      fixture.host.reconcile();
      setEnabled(enabled);
    });
  } };
}

async function sourceView(container: HTMLElement, expectLanguage = true) {
  const sourceElement = () => container.querySelector<HTMLElement>(".mdxeditor-source-editor .cm-editor") ??
    container.querySelector<HTMLElement>(".plain-code-editor .cm-editor");
  await waitFor(() => expect(sourceElement()).not.toBeNull());
  const view = EditorView.findFromDOM(sourceElement()!)!;
  if (expectLanguage) await waitFor(() => expect(view.state.facet(language)).not.toBeNull());
  return view;
}

async function richEditor(container: HTMLElement, text?: string, from?: number, to?: number) {
  const root = container.querySelector<HTMLElement>(".denote-editor-content")!;
  const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
  await act(async () => {
    root.focus();
    editor.update(() => {
      const node = $getRoot().getAllTextNodes().find((node) => !text || node.getTextContent() === text);
      if (node) {
        const range = node.select(from ?? node.getTextContentSize(), to ?? from ?? node.getTextContentSize());
        range.format = node.getFormat();
      }
      else $getRoot().selectEnd();
    }, { discrete: true });
  });
  return editor;
}

describe.each(["plain", "source", "rich"] as const)("two-character emoji prefixes in %s Markdown", (mode) => {
  it.each(["keyboard", "pointer"] as const)("immediately shows :smile: 😄 after typing exactly :sm and inserts Unicode by %s", async (accept) => {
    const fixture = harness(mode, "Before  after", { unicode: "😄" });
    const editor = mode === "rich" ? await richEditor(fixture.container, "Before  after", 7) : null;
    const view = mode === "rich" ? null : await sourceView(fixture.container);
    const target = view?.contentDOM ?? fixture.container.querySelector<HTMLElement>(".denote-editor-content")!;
    if (view) act(() => { view.focus(); view.dispatch({ selection: { anchor: 7 } }); });
    for (const character of ":sm") {
      await act(async () => {
        if (editor) {
          editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: character }));
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertText(character);
          }, { discrete: true });
        } else if (view) {
          const from = view.state.selection.main.head;
          view.dispatch({
            changes: { from, insert: character },
            selection: { anchor: from + 1 },
            annotations: Transaction.userEvent.of("input.type"),
          });
        }
      });
      if (character !== "m") expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    }
    expect(target).toHaveTextContent("Before :sm after");
    expect(target).toHaveFocus();
    const suggestion = screen.getByRole("button", { name: "Insert :smile: Smiling face" });
    expect(suggestion).toBeVisible();
    expect(within(suggestion).getByText(":smile:")).toBeVisible();
    expect(within(suggestion).getByText("😄")).toBeVisible();
    expect(within(suggestion).getByText("Smiling face")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(":smile:");
    if (accept === "keyboard") {
      fireEvent.keyDown(target, { key: "ArrowDown" });
      expect(target).toHaveFocus();
      fireEvent.keyDown(target, { key: "Enter" });
    } else {
      await userEvent.setup().click(suggestion);
    }
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("Before 😄 after"));
    expect(target).toHaveTextContent("Before 😄 after");
    expect(target).toHaveFocus();
    expect(target.querySelector("img")).toBeNull();
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    expect(fixture.save).toHaveBeenLastCalledWith(fixture.picker, { recents: ["😄"], favorites: [], tone: 0 });
    act(() => { if (editor) editor.dispatchCommand(UNDO_COMMAND, undefined); else if (view) undo(view); });
    await waitFor(() => expect(target).toHaveTextContent("Before :sm after"));
    act(() => { if (editor) editor.dispatchCommand(REDO_COMMAND, undefined); else if (view) redo(view); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("Before 😄 after"));
  });
});

describe.each(["plain", "source"] as const)("emoji transactions in %s Markdown", (mode) => {
  it.each(["[Link]()", "![Image]()"])("keeps partial shortcodes literal inside %s destinations", async (initial) => {
    const fixture = harness(mode, initial);
    const view = await sourceView(fixture.container);
    const from = initial.length - 1;
    act(() => {
      view.focus();
      view.dispatch({
        changes: { from, insert: ":sm" },
        selection: { anchor: from + 3 },
        annotations: Transaction.userEvent.of("input.type"),
      });
    });
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe(initial.slice(0, from) + ":sm)");
  });

  it("replaces selection, preserves surrounding bytes, and supports undo and redo", async () => {
    const original = "*  Keep this\n\nReplace me\n";
    const fixture = harness(mode, original);
    const view = await sourceView(fixture.container);
    act(() => { view.focus(); view.dispatch({ selection: { anchor: original.indexOf("Replace"), head: original.indexOf("Replace") + 7 } }); });
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Technologist" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("*  Keep this\n\n🧑‍💻 me\n"));
    expect(view.hasFocus).toBe(true);
    act(() => { undo(view); });
    expect(fixture.changed).toHaveBeenLastCalledWith(original);
    act(() => { redo(view); });
    expect(fixture.changed).toHaveBeenLastCalledWith("*  Keep this\n\n🧑‍💻 me\n");
  });
  it("offers top suggestions only for typing and replaces only the accepted candidate", async () => {
    const fixture = harness(mode, "Hello ");
    const view = await sourceView(fixture.container);
    act(() => {
      view.focus();
      view.dispatch({ changes: { from: 6, insert: ":sm" }, selection: { anchor: 9 }, annotations: Transaction.userEvent.of("input.type") });
    });
    expect(screen.getByLabelText("Emoji suggestions")).toBeInTheDocument();
    fireEvent.keyDown(view.contentDOM, { key: "Enter" });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("Hello 😀"));
    act(() => { undo(view); });
    expect(fixture.changed).toHaveBeenLastCalledWith("Hello :sm");
  });
  it("never accepts paste, composition or a closing colon automatically", async () => {
    const fixture = harness(mode, "");
    const view = await sourceView(fixture.container);
    act(() => {
      view.focus();
      view.dispatch({ changes: { from: 0, insert: ":smile:" }, selection: { anchor: 7 }, annotations: Transaction.userEvent.of("input.paste") });
    });
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe(":smile:");
    fireEvent.compositionStart(view.contentDOM);
    act(() => view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: ":sm" },
      selection: { anchor: 3 },
      annotations: Transaction.userEvent.of("input.type.compose"),
    }));
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    fireEvent.keyDown(view.contentDOM, { key: "Enter", isComposing: true });
    expect(view.state.doc.toString()).toContain(":sm");
    expect(view.state.doc.toString()).not.toContain("😀");
    fireEvent.compositionEnd(view.contentDOM);
  });
  it("rejects stale documents, selections and scopes", async () => {
    const fixture = harness(mode, "Synthetic");
    const view = await sourceView(fixture.container);
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 3 } }); fixture.host.open(fixture.picker); });
    act(() => { view.dispatch({ selection: { anchor: 5 } }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => fixture.host.open(fixture.picker));
    act(() => fixture.block());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.changed).not.toHaveBeenCalled();
  });
  it("preserves CRLF source bytes through insertion and undo", async () => {
    const original = "# Keep\r\n\r\nSynthetic\r\n";
    const fixture = harness(mode, original);
    const view = await sourceView(fixture.container);
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 12 } }); fixture.host.open(fixture.picker); });
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("# Keep\r\n\r\nSynt😀hetic\r\n"));
    act(() => { undo(view); });
    expect(fixture.changed).toHaveBeenLastCalledWith(original);
  });
  it.each(["```\none\ntwo\n", "`one\n"])("does not suggest inside multiline code %j", async (initial) => {
    const fixture = harness(mode, initial);
    const view = await sourceView(fixture.container);
    act(() => {
      view.focus();
      const end = view.state.doc.length;
      view.dispatch({ changes: { from: end, insert: ":sm" }, selection: { anchor: end + 3 }, annotations: Transaction.userEvent.of("input.type") });
    });
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
  });
  it("dismisses a candidate until the user types a different candidate", async () => {
    const fixture = harness(mode, "");
    const view = await sourceView(fixture.container);
    act(() => {
      view.focus();
      view.dispatch({ changes: { from: 0, insert: ":sm" }, selection: { anchor: 3 }, annotations: Transaction.userEvent.of("input.type") });
    });
    fireEvent.keyDown(view.contentDOM, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument());
    act(() => view.dispatch({ changes: { from: 3, insert: "i" }, selection: { anchor: 4 }, annotations: Transaction.userEvent.of("input.type") }));
    expect(screen.getByLabelText("Emoji suggestions")).toBeInTheDocument();
    fireEvent.compositionStart(view.contentDOM);
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
  });
});

describe("rich emoji transactions", () => {
  it("never replaces an explicit Source rewrite with an earlier emoji serialization", async () => {
    const fixture = harness("rich", "__bold__\n");
    await richEditor(fixture.container, "bold");
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("__bold😀__\n"));
    fireEvent.click(within(fixture.container).getByRole("radio", { name: "Source mode" }));
    const view = await sourceView(fixture.container);
    act(() => view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "**bold😀**" },
      annotations: Transaction.userEvent.of("input.type"),
    }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("**bold😀**"));
    act(() => { undo(view); });
    expect(fixture.changed).toHaveBeenLastCalledWith("__bold😀__\n");
    act(() => { redo(view); });
    expect(fixture.changed).toHaveBeenLastCalledWith("**bold😀**");
  });

  it.each(["First", "__First__\r\n"])("inserts in a new empty paragraph after %j", async (initial) => {
    const fixture = harness("rich", initial);
    const editor = await richEditor(fixture.container, "First");
    await act(async () => editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertParagraph();
    }, { discrete: true }));
    const beforeInsertion = fixture.changed.mock.lastCall?.[0] ?? initial;
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    const newline = initial.includes("\r\n") ? "\r\n" : "\n";
    await waitFor(() => expect(fixture.changed.mock.lastCall?.[0]).toContain(`${newline}${newline}😀`));
    const inserted = fixture.changed.mock.lastCall?.[0];
    expect(fixture.container.querySelector(".denote-editor-content p:last-child")).toHaveTextContent("😀");
    act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(beforeInsertion));
    act(() => { editor.dispatchCommand(REDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(inserted));
  });

  it("inserts in a new paragraph between two existing paragraphs", async () => {
    const fixture = harness("rich", "First\n\nSecond");
    const editor = await richEditor(fixture.container, "First");
    await act(async () => editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertParagraph();
    }, { discrete: true }));
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("First\n\n😀\n\nSecond"));
  });

  it("opens from the toolbar before the document has been focused", async () => {
    const fixture = harness("rich", "Synthetic");
    await screen.findByText("Synthetic");
    fireEvent.click(screen.getByRole("button", { name: "Emoji picker" }));
    fireEvent.click(await screen.findByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("😀Synthetic"));
  });
  it.each(["\n", "\r\n"])("preserves untouched Markdown and %j line endings, including undo/redo", async (newline) => {
    const original = ["*  First", "", "## Keep", "", "Replace here", ""].join(newline);
    const fixture = harness("rich", original);
    const editor = await richEditor(fixture.container, "Replace here", 0, 7);
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Technologist" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(original.replace("Replace", "🧑‍💻")));
    act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(original));
    act(() => { editor.dispatchCommand(REDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(original.replace("Replace", "🧑‍💻")));
  });
  it.each(["\n", "\r\n"])("preserves exact noncanonical bytes through undo, redo, fresh Source and serialization (%j)", async (newline) => {
    const original = [
      "__bold__ and *italic* with \\*literal\\*.",
      "",
      "+  First item",
      "+  Second item",
      "",
      "[Guide][topic] and [topic].",
      "",
      "  [topic]:  <https://example.test/guide>  'Synthetic title'",
      "",
      "Edit here",
      "",
    ].join(newline);
    const expected = original.replace("Edit here", "Edit 🧑‍💻");
    const fixture = harness("rich", original);
    const editor = await richEditor(fixture.container, "Edit here", 5, 9);
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Technologist" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(expected));
    act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(original));
    act(() => { editor.dispatchCommand(REDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(expected));
    fireEvent.click(within(fixture.container).getByRole("radio", { name: "Source mode" }));
    const source = await sourceView(fixture.container);
    await waitFor(() => expect(source.state.doc.toString()).toBe(expected.replace(/\r\n/g, "\n")));
    expect(fixture.changed).toHaveBeenLastCalledWith(expected);
    const offset = source.state.doc.toString().indexOf("Edit 🧑‍💻") + "Edit 🧑‍💻".length;
    act(() => source.dispatch({ changes: { from: offset, insert: "!" }, annotations: Transaction.userEvent.of("input.type") }));
    const edited = expected.replace("Edit 🧑‍💻", "Edit 🧑‍💻!");
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(edited));
    act(() => { undo(source); });
    expect(fixture.changed).toHaveBeenLastCalledWith(expected);
    act(() => { redo(source); });
    expect(fixture.changed).toHaveBeenLastCalledWith(edited);
    fireEvent.click(within(fixture.container).getByRole("radio", { name: "Rich text" }));
    await waitFor(() => expect(fixture.container.querySelector(".mdxeditor-rich-text-editor")).not.toHaveStyle({ display: "none" }));
    fireEvent.click(within(fixture.container).getByRole("radio", { name: "Source mode" }));
    const freshSource = await sourceView(fixture.container);
    await waitFor(() => expect(freshSource.state.doc.toString()).toBe(edited.replace(/\r\n/g, "\n")));
    expect(fixture.changed).toHaveBeenLastCalledWith(edited);
  });
  it("returns to the same caret after cancelling without touching content", async () => {
    const fixture = harness("rich", "Synthetic prose");
    const editor = await richEditor(fixture.container, "Synthetic prose", 5);
    act(() => fixture.host.open(fixture.picker));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search emoji" }), { key: "Escape" });
    await waitFor(() => expect(fixture.container.querySelector(".denote-editor-content")).toHaveFocus());
    expect(fixture.changed).not.toHaveBeenCalled();
    await act(async () => { editor.update(() => { $getRoot().getAllTextNodes()[0].select(5, 5); }, { discrete: true }); });
  });
  it("removes UI and rejects insertion on disable", async () => {
    const fixture = harness("rich", "Synthetic");
    await richEditor(fixture.container, "Synthetic");
    act(() => fixture.host.open(fixture.picker));
    act(() => fixture.disable());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.changed).not.toHaveBeenCalled();
  });
  it("autocompletes typed shortcodes as one undoable explicit choice", async () => {
    const fixture = harness("rich", "Hello");
    const editor = await richEditor(fixture.container, "Hello");
    await act(async () => {
      editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "m" }));
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(" :sm");
      }, { discrete: true });
    });
    expect(screen.getByLabelText("Emoji suggestions")).toBeInTheDocument();
    fireEvent.keyDown(fixture.container.querySelector(".denote-editor-content")!, { key: "Enter" });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("Hello 😀"));
    act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("Hello \\:sm"));
  });
  it("does not offer autocomplete for inline code", async () => {
    const fixture = harness("rich", "`Hi there`");
    const editor = await richEditor(fixture.container, "Hi there", 3);
    await act(async () => {
      editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "m" }));
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(":sm");
      }, { discrete: true });
    });
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
  });
  it("never offers or replaces rich shortcode text during IME composition", async () => {
    const fixture = harness("rich", "");
    const editor = await richEditor(fixture.container);
    const root = fixture.container.querySelector(".denote-editor-content")!;
    fireEvent.compositionStart(root);
    await act(async () => {
      editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "m", isComposing: true }));
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(":sm");
      }, { discrete: true });
    });
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    fireEvent.keyDown(root, { key: "Enter", isComposing: true });
    expect(root).toHaveTextContent(":sm");
    expect(root).not.toHaveTextContent("😀");
    fireEvent.compositionEnd(root);
    expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
  });
  it("keeps pasted rich shortcode text literal without suggestions", async () => {
    const fixture = harness("rich", "");
    await richEditor(fixture.container);
    const root = fixture.container.querySelector(".denote-editor-content")!;
    vi.stubGlobal("DragEvent", class SyntheticDragEvent extends MouseEvent {});
    vi.stubGlobal("ClipboardEvent", class SyntheticClipboardEvent extends Event {
      readonly clipboardData: DataTransfer | null;
      constructor(type: string, init: ClipboardEventInit = {}) {
        super(type, init);
        this.clipboardData = init.clipboardData ?? null;
      }
    });
    try {
      fireEvent.paste(root, { clipboardData: {
        getData: (format: string) => format === "text/plain" ? ":sm" : "",
        types: ["text/plain"], files: [],
      } });
      await waitFor(() => expect(root).toHaveTextContent(":sm"));
      expect(root).not.toHaveTextContent("😀");
      expect(screen.queryByLabelText("Emoji suggestions")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("closes the rich picker without inserting when its vault scope is locked", async () => {
    const fixture = harness("rich", "Synthetic");
    await richEditor(fixture.container);
    act(() => fixture.host.open(fixture.picker));
    expect(screen.getByRole("dialog", { name: "Emoji picker" })).toBeInTheDocument();
    act(() => fixture.block());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.changed).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });
  it("invalidates a captured rich selection after a caret move", async () => {
    const fixture = harness("rich", "Synthetic");
    const editor = await richEditor(fixture.container, "Synthetic", 2);
    act(() => fixture.host.open(fixture.picker));
    await act(async () => { editor.update(() => $getRoot().getAllTextNodes()[0].select(4, 4), { discrete: true }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("inserts into an empty note", async () => {
    const fixture = harness("rich", "");
    await richEditor(fixture.container);
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("😀"));
  });
  it("preserves surrounding inline formatting across a selected range", async () => {
    const fixture = harness("rich", "**Bold** plain");
    const editor = await richEditor(fixture.container, "Bold", 2);
    await act(async () => {
      editor.update(() => {
        const nodes = $getRoot().getAllTextNodes();
        const selection = nodes[0].select(2, 2);
        selection.format = nodes[0].getFormat();
        selection.focus.set(nodes[1].getKey(), 6, "text");
      }, { discrete: true });
    });
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("**Bo😀**"));
  });
  it("keeps literal entity and unrelated list bytes unchanged", async () => {
    const original = "*  Item\n\nA &amp; B";
    const fixture = harness("rich", original);
    await richEditor(fixture.container, "A & B", 5);
    act(() => fixture.host.open(fixture.picker));
    fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith(original + "😀"));
  });
  it("does not reuse a hidden rich selection after switching to Source", async () => {
    const fixture = harness("rich", "Synthetic");
    await richEditor(fixture.container, "Synthetic", 5);
    fireEvent.click(screen.getByRole("radio", { name: "Source mode" }));
    const view = await sourceView(fixture.container);
    act(() => view.dispatch({ selection: { anchor: 2 } }));
    fireEvent.click(screen.getByRole("button", { name: "Emoji picker" }));
    fireEvent.click(await screen.findByRole("button", { name: "Insert Smiling face" }));
    await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("Sy😀nthetic"));
  });
});

it.each(["plain", "source", "rich"] as const)("removes and restores %s hooks across repeated disable/re-enable", async (mode) => {
  const fixture = harness(mode, "Synthetic");
  for (let cycle = 0; cycle < 3; cycle++) {
    if (mode === "rich") await richEditor(fixture.container);
    else {
      const view = await sourceView(fixture.container);
      act(() => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.length } }); });
    }
    act(() => fixture.host.open(fixture.picker));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fixture.setEnabled(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fixture.setEnabled(true);
  }
  expect(fixture.changed).not.toHaveBeenCalled();
});

it.each(["plain", "source", "rich"] as const)("refuses an emoji picker on a read-only %s editor", async (mode) => {
  const fixture = harness(mode, "Synthetic", { readOnly: true });
  if (mode === "rich") await richEditor(fixture.container);
  else { const view = await sourceView(fixture.container); act(() => view.focus()); }
  act(() => fixture.host.open(fixture.picker));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fixture.changed).not.toHaveBeenCalled();
});

it.each(["plain", "source", "rich"] as const)("accepts numeric emoji shortcodes in %s Markdown", async (mode) => {
  const fixture = harness(mode, "", { shortcodes: ["100"] });
  if (mode === "rich") {
    const editor = await richEditor(fixture.container);
    await act(async () => {
      editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "0" }));
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(":100");
      }, { discrete: true });
    });
  } else {
    const view = await sourceView(fixture.container);
    act(() => {
      view.focus();
      view.dispatch({ changes: { from: 0, insert: ":100" }, selection: { anchor: 4 }, annotations: Transaction.userEvent.of("input.type") });
    });
  }
  fireEvent.click(await screen.findByRole("button", { name: "Insert :100: Smiling face" }));
  await waitFor(() => expect(fixture.changed).toHaveBeenLastCalledWith("😀"));
});

it.each(["synthetic.txt", "synthetic.mdx"])("does not register a picker target for %s", async (path) => {
  const fixture = harness("plain", "Plain text", { path });
  const view = await sourceView(fixture.container, false);
  act(() => { view.focus(); fixture.host.open(fixture.picker); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
