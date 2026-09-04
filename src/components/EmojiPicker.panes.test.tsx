import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { $getRoot, REDO_COMMAND, UNDO_COMMAND, type LexicalEditor } from "lexical";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { PluginEmojiPreferences } from "@denote/plugin-sdk";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { EmojiHost } from "../lib/emojiHost";
import { syntheticEmojiPicker } from "../lib/emoji.testFixtures";
import { EmojiHostSurface } from "./EmojiPicker";
import { MarkdownEditor } from "./MarkdownEditor";

it("keeps exact-byte histories separate across panes and retains recents during delayed preference writes", async () => {
  const picker = syntheticEmojiPicker();
  const host = new EmojiHost();
  let focusedScope = "left";
  let persisted: PluginEmojiPreferences = { recents: [], favorites: [], tone: 0 };
  const writes: { value: PluginEmojiPreferences; finish(): void }[] = [];
  const changed = { left: vi.fn(), right: vi.fn() };
  const error = vi.fn();
  host.configure({
    pickers: [picker],
    allowed: (scope) => scope === focusedScope,
    preferences: () => persisted,
    save: (_picker, value) => new Promise<void>((resolve) => {
      writes.push({ value, finish: () => { persisted = value; resolve(); } });
    }),
    error,
  });
  function Pane({ scope, initial }: { scope: "left" | "right"; initial: string }) {
    const [markdown, setMarkdown] = useState(initial);
    return <section data-testid={scope} onFocusCapture={() => { focusedScope = scope; host.reconcile(); }}>
      <MarkdownEditor
        notePath={`${scope}.md`}
        markdown={markdown}
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        preferredViewMode="rich-text"
        readOnly={false}
        emoji={{ host, scope }}
        onChange={(value) => { changed[scope](value); setMarkdown(value); }}
        onError={error}
        onViewModeChange={vi.fn()}
        onLinkOpen={vi.fn()}
        onImageUpload={vi.fn()}
      />
    </section>;
  }
  render(<>
    <Pane scope="left" initial={"__same__\n"} />
    <Pane scope="right" initial={"**same**\n"} />
    <EmojiHostSurface host={host} />
  </>);
  const focus = async (scope: "left" | "right") => {
    const root = screen.getByTestId(scope).querySelector<HTMLElement>(".denote-editor-content")!;
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    await act(async () => {
      root.focus();
      editor.update(() => {
        const node = $getRoot().getAllTextNodes()[0];
        const selection = node.selectEnd();
        selection.format = node.getFormat();
      }, { discrete: true });
    });
    return editor;
  };
  const left = await focus("left");
  act(() => host.open(picker));
  fireEvent.click(screen.getByRole("button", { name: "Insert Smiling face" }));
  await waitFor(() => expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n"));
  expect(writes[0].value.recents).toEqual(["😀"]);

  await focus("right");
  act(() => host.open(picker));
  fireEvent.click(screen.getByRole("button", { name: "Insert Technologist" }));
  await waitFor(() => expect(changed.right).toHaveBeenLastCalledWith("**same🧑‍💻**\n"));
  expect(writes[1].value.recents).toEqual(["🧑‍💻", "😀"]);
  expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n");

  await act(async () => writes[0].finish());
  expect(host.preferences(picker).recents).toEqual(["🧑‍💻", "😀"]);
  await focus("left");
  act(() => { left.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(changed.left).toHaveBeenLastCalledWith("__same__\n"));
  expect(changed.right).toHaveBeenLastCalledWith("**same🧑‍💻**\n");
  act(() => { left.dispatchCommand(REDO_COMMAND, undefined); });
  await waitFor(() => expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n"));

  act(() => host.open(picker));
  act(() => { focusedScope = "right"; host.reconcile(); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(writes).toHaveLength(2);
  await act(async () => writes[1].finish());
  expect(host.preferences(picker).recents).toEqual(["🧑‍💻", "😀"]);
  expect(error).not.toHaveBeenCalled();
});
