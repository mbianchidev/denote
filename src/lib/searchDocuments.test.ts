import { describe, expect, it } from "vitest";
import type { SearchDocument } from "../types";
import { readSearchSnapshot, VaultSearchDocuments } from "./searchDocuments";

const document = (path: string, content: string): SearchDocument => ({
  path, title: path, content, contentHash: content, contentBytes: new TextEncoder().encode(content).length,
  encoding: "utf8", lineEnding: "lf", kind: "markdown", tags: [], bookmarked: false, lastOpenedAt: null,
});
const batch = (documents: SearchDocument[]) => ({ documents, skippedCount: 0, truncated: false });

describe("shared vault documents", () => {
  it("loads a large file inventory through bounded native requests rather than one vault-sized response", async () => {
    const files = Array.from({ length: 1_000 }, (_, index) => ({
      path: `synthetic/${index}.md`, name: `${index}.md`, kind: "markdown" as const,
      children: [], size: 4_000, bookmarked: false, pinned: false, modifiedAt: null,
    }));
    const requests: string[][] = [];
    const result = await readSearchSnapshot(files, async (paths) => {
      requests.push(paths);
      return batch(paths.map((path) => document(path, "synthetic")));
    }, () => true);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((paths) => paths.length <= 128 && paths.length * 4_000 * 4 / 3 <= 512 * 1024)).toBe(true);
    expect(result.documents).toHaveLength(files.length);
    expect(new Set(requests.flat()).size).toBe(files.length);
  });

  it("stops native indexing batches as soon as the vault generation changes", async () => {
    let current = true;
    await expect(readSearchSnapshot([{
      path: "Synthetic.md", name: "Synthetic.md", kind: "markdown", children: [],
      size: 1, bookmarked: false, pinned: false, modifiedAt: null,
    }], async () => {
      current = false;
      return batch([document("Synthetic.md", "synthetic")]);
    }, () => current)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not resurrect files deleted while an older native scan was in flight", () => {
    const store = new VaultSearchDocuments();
    const scan = store.revision;
    store.removeRegions(["removed"]);
    expect(store.replace(batch([document("removed/Old.md", "old"), document("Keep.md", "keep")]), scan)
      .documents.map((document) => document.path)).toEqual(["Keep.md"]);
    expect(store.update(["removed"], batch([document("removed/New.md", "new")]))
      .documents.map((document) => document.path)).toEqual(["Keep.md", "removed/New.md"]);
  });

  it("replaces only touched regions and preserves unchanged object identities for derived indexes", () => {
    const store = new VaultSearchDocuments();
    const first = document("notes/First.md", "first");
    const other = document("other/Keep.md", "other");
    store.replace(batch([first, other]));
    const changed = document(first.path, "changed");
    const result = store.update(["notes"], batch([changed]));
    expect(result.documents).toEqual([changed, other]);
    expect(result.documents[1]).toBe(other);
    const refreshed = store.replace(batch([{ ...other }, { ...changed }]));
    expect(refreshed.documents[0]).toBe(other);
    expect(refreshed.documents[1]).toBe(changed);
    expect(store.removePaths((path) => path.startsWith("notes/")).documents).toEqual([other]);
  });

  it("keeps a global byte budget and does not accumulate repeated skipped-file counts", () => {
    const store = new VaultSearchDocuments(10);
    store.replace(batch([document("Keep.md", "12345"), document("Change.md", "67890")]));
    expect(store.availableBytes(["Change.md"])).toBe(5);
    expect(() => store.update(["Change.md"], batch([document("Change.md", "123456")]))).toThrow(/budget/u);
    expect(store.snapshot.documents).toHaveLength(2);
    const skipped = { documents: [], skippedPaths: ["Change.md"], skippedCount: 1, truncated: false };
    expect(store.update(["Change.md"], skipped).skippedCount).toBe(1);
    expect(store.update(["Change.md"], skipped).skippedCount).toBe(1);
    expect(store.update(["Change.md"], batch([document("Change.md", "ok")])).skippedCount).toBe(0);
  });
});
