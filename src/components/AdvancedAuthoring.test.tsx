import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginAuthoringRequest, PluginAuthoringResult } from "@denote/plugin-sdk";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import type { AuthoringEditorBinding } from "../lib/authoring";
import { AdvancedAuthoring } from "./AdvancedAuthoring";

const original = "# Keep **this**.  \n\nColor me.\n";
const provider = { pluginId: "denote.text-styling", id: "denote.text-styling.styles", title: "Styles", feature: "text-styling" as const };
function SelectionFixture({ source, binding }: { source: string; binding: AuthoringEditorBinding }) {
  useLayoutEffect(() => binding.registerSelection(() => {
    const from = source.indexOf("Color me");
    return { source, from, to: from + 8, restore: () => {} };
  }), [source, binding]);
  return <textarea aria-label="Exact note source" value={source} readOnly />;
}
const request = vi.fn(async (_plugin: string, _id: string, request: PluginAuthoringRequest): Promise<PluginAuthoringResult> => {
  structuredClone(request);
  if (request.feature !== "text-styling") throw new Error("Unexpected request");
  if (request.action === "parse") return { feature: "text-styling", action: "parse", spans: [], notices: [] };
  const delimiter = `=${request.color}${request.style === "color" ? ":text" : ""}=`;
  return { feature: "text-styling", action: "format",
    edit: { from: request.from, to: request.to, text: delimiter + request.source.slice(request.from, request.to) + delimiter } };
});

function Harness({ changed, readOnly = false }: { changed: (source: string) => void; readOnly?: boolean }) {
  const [source, setSource] = useState(original);
  return <AdvancedAuthoring path="Example.md" source={source} readOnly={readOnly} active providers={[provider]}
    lineEnding="lf" displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} request={request}
    loadComments={async () => { throw new Error("Unexpected comments"); }}
    saveComments={async () => { throw new Error("Unexpected comments"); }}
    renderEditor={(binding) => <SelectionFixture source={source} binding={binding} />}
    renderPreview={() => null} onChange={(source) => { changed(source); setSource(source); }} />;
}

describe("optional authoring toolbar", () => {
  it("registers the same comments dialog for host actions and removes the action on teardown", async () => {
    const dispose = vi.fn();
    const register = vi.fn((_open: () => void) => dispose);
    const view = render(<AdvancedAuthoring path="Example.md" source={original} readOnly={false} active
      providers={[{ pluginId: "denote.note-comments", id: "denote.note-comments.anchors", title: "Note comments", feature: "note-comments" }]}
      registerCommentsAction={register} lineEnding="lf" displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
      request={async () => ({ feature: "note-comments", action: "locate", anchors: [] })}
      loadComments={async () => ({ contentHash: "a".repeat(64), document: { schemaVersion: 1, owner: "denote.note-comments", notes: {} } })}
      saveComments={async () => { throw new Error("Unexpected comment save"); }}
      renderEditor={() => <p>A synthetic note.</p>} renderPreview={() => null} onChange={vi.fn()} />);
    expect(register).toHaveBeenCalledOnce();
    act(() => register.mock.calls[0][0]());
    await screen.findByRole("dialog", { name: "Comments" });
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("formats only the captured range through a keyboard-opened palette", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    await screen.findByLabelText("Exact note source");
    fireEvent.keyDown(window, { key: "H", code: "KeyH", ctrlKey: true, shiftKey: true });
    await screen.findByRole("dialog", { name: "Text style" });
    await user.selectOptions(screen.getByLabelText("Color"), "blue");
    await user.click(screen.getByRole("button", { name: "Apply style" }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(original.replace("Color me", "=blue=Color me=blue=")));
    expect(screen.getByLabelText("Exact note source")).toHaveValue(original.replace("Color me", "=blue=Color me=blue="));
  });

  it("never offers a mutation in read mode or changes a note merely by opening", async () => {
    const changed = vi.fn();
    render(<Harness changed={changed} readOnly />);
    await screen.findByLabelText("Exact note source");
    expect(screen.getByRole("button", { name: "Text style" })).toBeDisabled();
    expect(changed).not.toHaveBeenCalled();
  });
});
