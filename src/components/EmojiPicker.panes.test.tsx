import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { $getRoot, REDO_COMMAND, UNDO_COMMAND, type LexicalEditor } from "lexical";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { PluginEmojiPreferences } from "@denote/plugin-sdk";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { EmojiHost } from "../lib/emojiHost";
import { syntheticEmojiPicker } from "../lib/emoji.testFixtures";
import { EmojiHostSurface } from "./EmojiPicker";
import { MarkdownEditor } from "./MarkdownEditor";

function renderPanes() {
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
  const insert = async (scope: "left" | "right", name: string) => {
    const editor = await focus(scope);
    act(() => host.open(picker));
    const dialog = within(screen.getByRole("dialog", { name: picker.title }));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: `Insert ${name}` }));
    });
    return editor;
  };
  return { host, picker, changed, writes, error, focus, insert };
}

it("keeps exact-byte histories separate across panes and dismisses a picker when focus changes", async () => {
  const { host, picker, changed, writes, error, focus, insert } = renderPanes();
  const left = await insert("left", "Smiling face");
  expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n");
  await insert("right", "Technologist");
  expect(changed.right).toHaveBeenLastCalledWith("**same🧑‍💻**\n");
  expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n");

  await act(async () => writes[0].finish());
  await focus("left");
  await act(async () => { left.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(changed.left).toHaveBeenLastCalledWith("__same__\n");
  expect(changed.right).toHaveBeenLastCalledWith("**same🧑‍💻**\n");
  await act(async () => { left.dispatchCommand(REDO_COMMAND, undefined); });
  expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n");

  act(() => host.open(picker));
  expect(screen.getByRole("dialog", { name: picker.title })).toBeVisible();
  await focus("right");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(writes).toHaveLength(2);
  await act(async () => writes[1].finish());
  expect(error).not.toHaveBeenCalled();
});

it("retains recents across panes while earlier preference writes are still pending", async () => {
  const { host, picker, changed, writes, error, insert } = renderPanes();
  await insert("left", "Smiling face");
  expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n");
  expect(writes[0].value.recents).toEqual(["😀"]);

  await insert("right", "Technologist");
  expect(changed.right).toHaveBeenLastCalledWith("**same🧑‍💻**\n");
  expect(changed.left).toHaveBeenLastCalledWith("__same😀__\n");
  expect(writes).toHaveLength(2);
  expect(writes[1].value.recents).toEqual(["🧑‍💻", "😀"]);

  await act(async () => writes[0].finish());
  expect(host.preferences(picker).recents).toEqual(["🧑‍💻", "😀"]);
  await act(async () => writes[1].finish());
  expect(host.preferences(picker).recents).toEqual(["🧑‍💻", "😀"]);
  expect(error).not.toHaveBeenCalled();
});
