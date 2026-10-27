import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteCommentsPanel } from "./NoteCommentsPanel";
import type { NoteCommentsDocument, NoteCommentsSnapshot } from "../lib/noteComments";
import type { PluginAuthoringRequest, PluginAuthoringResult } from "@denote/plugin-sdk";

const empty: NoteCommentsSnapshot = {
  contentHash: "a".repeat(64), document: { schemaVersion: 1, owner: "denote.note-comments", notes: {} },
};
const comment = {
  id: "11111111-2222-4333-8444-555555555555", body: "An invented comment.", anchor: null,
  resolved: false, createdAt: 1, updatedAt: 1,
};
const request = vi.fn(async (request: PluginAuthoringRequest): Promise<PluginAuthoringResult> => {
  if (request.feature === "note-comments" && request.action === "anchor") {
    return { feature: "note-comments", action: "anchor", anchor: null };
  }
  if (request.feature === "note-comments" && request.action === "locate") {
    return {
      feature: "note-comments", action: "locate",
      anchors: request.anchors.map(({ id }) => ({ id, status: "attached", from: 0, to: 0 })),
    };
  }
  throw new Error("Unexpected synthetic request.");
});

describe("keyboard-complete note comments", () => {
  it("creates and edits a whole-note comment without changing Markdown", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_hash: string, document: NoteCommentsDocument, _source: string) => ({ contentHash: "b".repeat(64), document }));
    render(<NoteCommentsPanel path="Example.md" source="# Example" selection={null}
      request={request} load={async () => empty} save={save} onClose={vi.fn()} onNavigate={vi.fn()} readOnly={false} />);
    await screen.findByLabelText("Comment");
    await user.type(screen.getByLabelText("Comment"), "A new synthetic comment.");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].notes["Example.md"][0].body).toBe("A new synthetic comment.");
    expect(save.mock.calls[0][2]).toBe("# Example");
    await user.click(screen.getByRole("button", { name: "Edit comment" }));
    await user.clear(screen.getByLabelText("Comment"));
    await user.type(screen.getByLabelText("Comment"), "An updated comment.");
    await user.click(screen.getByRole("button", { name: "Save comment" }));
    await screen.findByText("An updated comment.");
  });

  it("resolves, reopens, and confirms deletion with a surviving keyboard focus target", async () => {
    const user = userEvent.setup();
    render(<NoteCommentsPanel path="Example.md" source="# Example" selection={null}
      request={request} load={async () => ({ ...empty, document: { ...empty.document, notes: { "Example.md": [comment] } } })}
      save={async (_hash, document) => ({ ...empty, document })} onClose={vi.fn()} onNavigate={vi.fn()} readOnly={false} />);
    await user.click(await screen.findByRole("button", { name: "Resolve comment" }));
    await user.selectOptions(screen.getByLabelText("Show comments"), "resolved");
    await user.click(await screen.findByRole("button", { name: "Reopen comment" }));
    await user.selectOptions(screen.getByLabelText("Show comments"), "open");
    await user.click(await screen.findByRole("button", { name: "Delete comment" }));
    const confirmation = screen.getByRole("group", { name: "Delete this comment?" });
    await user.click(within(confirmation).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText(comment.body)).not.toBeInTheDocument());
    expect(screen.getByLabelText("Comment")).toHaveFocus();
  });

  it("keeps a failed write and draft visible and closes with Escape", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<NoteCommentsPanel path="Example.md" source="# Example" selection={null}
      request={request} load={async () => empty} save={async () => { throw new Error("Comments changed externally."); }}
      onClose={close} onNavigate={vi.fn()} readOnly={false} />);
    await user.type(await screen.findByLabelText("Comment"), "Keep this draft.");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Comments changed externally.");
    expect(screen.getByLabelText("Comment")).toHaveValue("Keep this draft.");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).toHaveBeenCalled();
  });
});
