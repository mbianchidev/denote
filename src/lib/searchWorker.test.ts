import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultSearchIndex } from "./search";
import { VaultSearchWorker, type SearchWorkerRequest, type SearchWorkerResponse } from "./searchWorker";
import type { SearchDocument } from "../types";

const workers: SyntheticWorker[] = [];
const clients: VaultSearchWorker[] = [];
class SyntheticWorker {
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: SearchWorkerRequest[] = [];
  readonly replies: SearchWorkerResponse[] = [];
  private index = new VaultSearchIndex();
  private stopped = false;
  constructor() { workers.push(this); }
  terminate() { this.stopped = true; }
  postMessage(request: SearchWorkerRequest) {
    this.requests.push(request);
    void (async () => {
      let response: SearchWorkerResponse;
      try {
        if (request.type === "query") {
          const rows = await this.index.query(request.request);
          response = { id: request.id, value: rows.map(({ document, ...row }) => ({ ...row, path: document.path })) };
        } else {
          if (request.type === "update") await this.index.update(request.documents, request.removedPaths);
          else this.index.recordOpen(request.path, request.lastOpenedAt);
          response = { id: request.id, value: null };
        }
      } catch (error) {
        response = { id: request.id, error: String(error), cancelled: false };
      }
      this.replies.push(response);
      if (!this.stopped) this.onmessage?.(new MessageEvent("message", { data: response }));
    })();
  }
}
beforeEach(() => { workers.length = 0; vi.stubGlobal("Worker", SyntheticWorker); });
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.unstubAllGlobals(); });
const document = (path: string, content: string): SearchDocument => ({
  path, content, contentHash: content, title: path, tags: [], kind: "markdown",
  encoding: "utf8", lineEnding: "lf", bookmarked: false, lastOpenedAt: null,
});
const client = () => { const value = new VaultSearchWorker(vi.fn()); clients.push(value); return value; };

describe("vault search worker transport", () => {
  it("sends only changed documents and hydrates compact query replies with the existing source object", async () => {
    const index = client();
    const first = document("First.md", "original");
    const retained = document("Retained.md", "retained");
    await index.rebuild([first, retained]);
    workers[0].requests.length = 0;
    const changed = document(first.path, "incremental marker");
    await index.rebuild([changed, retained]);
    const update = workers[0].requests[0];
    expect(update.type === "update" && update.documents).toEqual([changed]);
    const results = await index.query("incremental");
    expect(results[0].document).toBe(changed);
    const reply = workers[0].replies[workers[0].replies.length - 1];
    expect(reply && "value" in reply && reply.value?.[0]).not.toHaveProperty("document");
    expect(reply && "value" in reply && reply.value?.[0]).not.toHaveProperty("content");
  });

  it("reports worker failure and rebuilds all retained documents before recovering", async () => {
    const index = client();
    const documents = [document("First.md", "marker"), document("Second.md", "retained")];
    await index.rebuild(documents);
    workers[0].onerror?.(new ErrorEvent("error", { message: "Synthetic worker failure" }));
    await expect(index.query("marker")).rejects.toThrow("Synthetic worker failure");
    await index.rebuild(documents);
    expect(workers).toHaveLength(2);
    expect((await index.query("marker"))[0].document.path).toBe("First.md");
  });

  it("releases a vault's sources and refuses new queries after disposal", async () => {
    const index = client();
    await index.rebuild([document("First.md", "marker")]);
    index.dispose();
    await expect(index.query("marker")).rejects.toMatchObject({ name: "AbortError" });
  });
});
