import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NoteComment, NoteCommentsSnapshot } from "../lib/noteComments";
import { useNoteCommentCount } from "./useNoteCommentCount";

const provider = {
  pluginId: "denote.note-comments", id: "denote.note-comments.anchors",
  title: "Note comments", feature: "note-comments",
} as const;
const vault = "/synthetic-comment-vault";
const comment = (id: number, resolved = false): NoteComment => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  body: `Synthetic comment ${id}`, anchor: null, resolved, createdAt: 1, updatedAt: 1,
});
const snapshot = (): NoteCommentsSnapshot => ({
  contentHash: "a".repeat(64),
  document: {
    schemaVersion: 1, owner: "denote.note-comments",
    notes: { "First.md": [comment(1), comment(2), comment(3, true)], "Second.md": [comment(4)] },
  },
});

describe("active-note comment counts", () => {
  it("counts only the active note's open comments, refreshes on navigation, and accepts saved snapshots", async () => {
    const read = vi.fn(async () => snapshot());
    const { result, rerender } = renderHook(({ path }) =>
      useNoteCommentCount(vault, provider, path, read), { initialProps: { path: "First.md" } });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(read).toHaveBeenCalledWith(provider.pluginId, vault);
    rerender({ path: "Second.md" });
    expect(result.current.count).toBeNull();
    await waitFor(() => expect(result.current.count).toBe(1));
    rerender({ path: "First.md" });
    await waitFor(() => expect(result.current.count).toBe(2));
    const saved = snapshot();
    saved.document.notes["First.md"][0].resolved = true;
    act(() => result.current.update(vault, provider.pluginId, saved));
    expect(result.current.count).toBe(1);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("ignores obsolete reads and saved snapshots from a different vault or plugin", async () => {
    let finish!: (value: NoteCommentsSnapshot) => void;
    const pending = new Promise<NoteCommentsSnapshot>((resolve) => { finish = resolve; });
    const read = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(snapshot());
    const { result, rerender } = renderHook(({ path }) =>
      useNoteCommentCount(vault, provider, path, read), { initialProps: { path: "First.md" } });
    rerender({ path: "Second.md" });
    await waitFor(() => expect(result.current.count).toBe(1));
    await act(async () => finish(snapshot()));
    expect(result.current.count).toBe(1);
    act(() => result.current.update("/other-synthetic-vault", provider.pluginId, snapshot()));
    act(() => result.current.update(vault, "denote.other", snapshot()));
    expect(result.current.count).toBe(1);
  });

  it("never replaces a newer saved count with an earlier pending read", async () => {
    let finish!: (value: NoteCommentsSnapshot) => void;
    const read = vi.fn(() => new Promise<NoteCommentsSnapshot>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useNoteCommentCount(vault, provider, "First.md", read));
    const saved = snapshot();
    saved.document.notes["First.md"] = [comment(1, true)];
    act(() => result.current.update(vault, provider.pluginId, saved));
    expect(result.current.count).toBe(0);
    await act(async () => finish(snapshot()));
    expect(result.current.count).toBe(0);
  });

  it("clears counts immediately on lock or provider withdrawal and reads again after unlock", async () => {
    const read = vi.fn(async () => snapshot());
    const { result, rerender } = renderHook(({ enabled }) =>
      useNoteCommentCount(enabled ? vault : null, enabled ? provider : null, "First.md", read),
    { initialProps: { enabled: false } });
    expect(result.current.count).toBeNull();
    expect(read).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.count).toBe(2));
    rerender({ enabled: false });
    expect(result.current.count).toBeNull();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable or invalid sidecars instead of pretending a note has no comments", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Comments sidecar is unavailable."))
      .mockResolvedValue({ ...snapshot(), contentHash: "invalid" });
    const { result, rerender } = renderHook(({ path }) =>
      useNoteCommentCount(vault, provider, path, read), { initialProps: { path: "First.md" } });
    await waitFor(() => expect(result.current.error).toBe("Comments sidecar is unavailable."));
    expect(result.current.count).toBeNull();
    rerender({ path: "Second.md" });
    await waitFor(() => expect(result.current.error).toMatch(/invalid comments sidecar/i));
    expect(result.current.count).toBeNull();
  });
});
