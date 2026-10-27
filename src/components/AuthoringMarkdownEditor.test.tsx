import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor, UNDO_COMMAND } from "lexical";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginAuthoringRequest, PluginAuthoringResult } from "@denote/plugin-sdk";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { AdvancedAuthoring } from "./AdvancedAuthoring";
import { MarkdownEditor } from "./MarkdownEditor";
import { styleRequest } from "../../plugins/text-styling/src/styling";

const original = "---\ncustom: keep\n---\n\n# Synthetic note\n\nColor me.\n\nKeep **this** and [link](https://example.test/).  \n";
const provider = { pluginId: "denote.text-styling", id: "denote.text-styling.styles", title: "Styles", feature: "text-styling" as const };
const request = async (_plugin: string, _id: string, request: PluginAuthoringRequest): Promise<PluginAuthoringResult> => {
  return styleRequest(request);
};

function Harness({ initial = original, changed }: { initial?: string; changed: (source: string) => void }) {
  const [source, setSource] = useState(initial);
  const update = (next: string) => { changed(next); setSource(next); };
  return <AdvancedAuthoring path="Example.md" source={source} readOnly={false} active providers={[provider]}
    lineEnding="lf" displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} request={request}
    loadComments={async () => { throw new Error("Unexpected comments"); }} saveComments={async () => { throw new Error("Unexpected comments"); }}
    renderPreview={() => null} onChange={update}
    renderEditor={(binding, navigation) => <MarkdownEditor notePath="Example.md" markdown={source} lineEnding="lf"
      displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} preferredViewMode="rich-text" readOnly={false} authoring={binding}
      searchNavigation={navigation} onChange={update} onError={vi.fn()} onViewModeChange={() => {}}
      onLinkOpen={() => {}} onImageUpload={vi.fn()} />} />;
}

describe("real Markdown authoring integration", () => {
  it("renders decoded text but preserves the original entity spelling during an unrelated edit", async () => {
    const changed = vi.fn();
    const source = "=red=A &amp; B=red=\n\nAfter.";
    render(<Harness initial={source} changed={changed} />);
    expect(await screen.findByText("A & B", { exact: true })).toHaveClass("denote-text-style");
    const root = screen.getByRole("textbox", { name: "editable markdown" });
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    act(() => editor.update(() => {
      $getRoot().getLastDescendant()?.selectEnd();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected an invented edit caret.");
      selection.insertText("!");
    }, { discrete: true }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(source + "!"));
  });

  it("does not reinterpret an escaped copy of an otherwise active style token", async () => {
    const changed = vi.fn();
    const source = "=red=Color me=red=\n\nLiteral \\=red=Color me=red=.\n\nAfter.";
    const view = render(<Harness initial={source} changed={changed} />);
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    expect(view.container.querySelectorAll(".denote-text-style")).toHaveLength(1);
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    act(() => editor.update(() => {
      $getRoot().getLastDescendant()?.selectEnd();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected an invented edit caret.");
      selection.insertText("!");
    }, { discrete: true }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(source + "!"));
  });

  it.each(["**", "*", "~~"])("retains surrounding %s formatting during an unrelated Rich edit", async (marker) => {
    const changed = vi.fn();
    const source = `${marker}=red=Color me=red=${marker}\n\nAfter.`;
    render(<Harness initial={source} changed={changed} />);
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    act(() => editor.update(() => {
      $getRoot().getLastDescendant()?.selectEnd();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected an invented edit caret.");
      selection.insertText("!");
    }, { discrete: true }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(source + "!"));
  });

  it("continues adjacent formatting containers around a styled leaf", async () => {
    const changed = vi.fn();
    const source = "**Before =red=Color me=red= after**\n\nAfter.";
    render(<Harness initial={source} changed={changed} />);
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    act(() => editor.update(() => {
      $getRoot().getLastDescendant()?.selectEnd();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected an invented edit caret.");
      selection.insertText("!");
    }, { discrete: true }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(source + "!"));
  });

  it("clears an excerpt in the existing Rich history and undoes without losing unrelated source", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const styled = original.replace("Color me", "=red=Color me=red=");
    render(<Harness initial={styled} changed={changed} />);
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    await user.click(screen.getByRole("button", { name: "Text style" }));
    await user.click(screen.getByRole("button", { name: "Clear text style 1" }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(original));
    expect(screen.getByRole("textbox", { name: "editable markdown" })).toBe(root);
    act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(styled));
  });

  it("renders styles while retaining exact source and never publishes view-only changes", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const source = original.replace("Color me", "=red=Color me=red=");
    const view = render(<Harness initial={source} changed={changed} />);
    expect(await screen.findByText("Color me")).toHaveClass("denote-text-style");
    await user.click(screen.getByRole("radio", { name: "Source mode" }));
    await waitFor(() => expect(view.container.querySelector(".cm-content")).toHaveTextContent("=red=Color me=red="));
    await user.click(screen.getByRole("radio", { name: "Rich text" }));
    expect(await screen.findByText("Color me")).toHaveClass("denote-text-style");
    expect(changed).not.toHaveBeenCalled();
  });

  it("formats a real Rich selection and undoes it without changing any unrelated source", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    const root = await screen.findByRole("textbox", { name: "editable markdown" });
    const editor = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    act(() => editor.update(() => {
      const text = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === "Color me.");
      if (!text) throw new Error("Missing invented selection.");
      text.select(0, 8);
    }, { discrete: true }));
    await user.click(screen.getByRole("button", { name: "Text style" }));
    await user.selectOptions(screen.getByLabelText("Color"), "red");
    await user.click(screen.getByRole("button", { name: "Apply style" }));
    const expected = original.replace("Color me", "=red=Color me=red=");
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(expected));
    expect(screen.getByText("Color me")).toHaveClass("denote-text-style");
    act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(original));
  });
});
