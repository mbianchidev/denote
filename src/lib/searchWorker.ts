import type { SearchRequest } from "./search";
import { sameSearchContent } from "./search";
import type { SearchDocument, SearchResult } from "../types";

export type SearchWorkerRequest =
  | { id: number; type: "update"; documents: SearchDocument[]; removedPaths: string[] }
  | { id: number; type: "query"; request: SearchRequest | string }
  | { id: number; type: "opened"; path: string; lastOpenedAt: string | null };
export type SearchWorkerResult = Omit<SearchResult, "document"> & { path: string };
export type SearchWorkerResponse =
  | { id: number; value: SearchWorkerResult[] | null }
  | { id: number; error: string; cancelled: boolean };

export class VaultSearchWorker {
  private worker: Worker | null = null;
  private documents = new Map<string, SearchDocument>();
  private opened = new Map<string, string | null>();
  private sequence = 0;
  private closed = false;
  private fault: Error | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<number, {
    resolve: (value: SearchWorkerResult[] | null) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly reportError: (error: unknown) => void = console.error) {}

  rebuild(documents: SearchDocument[]): Promise<void> {
    const operation = this.tail.catch(() => undefined).then(async () => {
      this.assertOpen();
      const recover = this.fault !== null;
      this.fault = null;
      const next = new Map(documents.map((document) => [document.path,
        this.opened.has(document.path) ? { ...document, lastOpenedAt: this.opened.get(document.path)! } : document,
      ]));
      const removed = [...this.documents.keys()].filter((path) => !next.has(path));
      const changed = [...next.values()].filter((document) => {
        const previous = this.documents.get(document.path);
        return recover || !previous || !sameSearchContent(previous, document) ||
          previous.bookmarked !== document.bookmarked || previous.lastOpenedAt !== document.lastOpenedAt ||
          previous.kind !== document.kind;
      });
      try {
        if (removed.length) await this.call({ type: "update", documents: [], removedPaths: removed });
        let batch: SearchDocument[] = [];
        let size = 0;
        for (const document of changed) {
          if (batch.length && size + document.content.length > 512 * 1024) {
            await this.call({ type: "update", documents: batch, removedPaths: [] });
            batch = [];
            size = 0;
          }
          batch.push(document);
          size += document.content.length;
        }
        if (batch.length) await this.call({ type: "update", documents: batch, removedPaths: [] });
        this.assertOpen();
        this.documents = next;
      } catch (error) {
        if (!this.closed) this.fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });
    this.tail = operation;
    return operation;
  }

  async query(request: SearchRequest | string): Promise<SearchResult[]> {
    await this.tail;
    this.assertOpen();
    if (this.fault) throw this.fault;
    if (this.documents.size === 0) return [];
    const documents = this.documents;
    const results = await this.call({ type: "query", request });
    if (!results) throw new Error("The search worker returned no query result.");
    return results.flatMap(({ path, ...result }) => {
      const document = documents.get(path);
      return document ? [{ ...result, document }] : [];
    });
  }

  recordOpen(path: string, lastOpenedAt: string | null): void {
    this.opened.set(path, lastOpenedAt);
    const document = this.documents.get(path);
    if (document) this.documents.set(path, { ...document, lastOpenedAt });
    const operation = this.tail.then(async () => {
      const document = this.documents.get(path);
      if (document) {
        this.documents.set(path, { ...document, lastOpenedAt });
        await this.call({ type: "opened", path, lastOpenedAt });
      }
    });
    this.tail = operation;
    void operation.catch((error) => { if (!this.closed) this.reportError(error); });
  }

  removePaths(remove: (path: string) => boolean): Promise<void> {
    const removed = new Set([...this.documents.keys()].filter(remove));
    for (const path of removed) { this.documents.delete(path); this.opened.delete(path); }
    const operation = this.tail.then(async () => {
      for (const path of this.documents.keys()) {
        if (remove(path)) { removed.add(path); this.documents.delete(path); this.opened.delete(path); }
      }
      if (removed.size) await this.call({ type: "update", documents: [], removedPaths: [...removed] });
    }).catch((error) => {
      if (!this.closed) this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });
    this.tail = operation;
    return operation;
  }

  dispose(): void {
    this.closed = true;
    this.documents.clear();
    this.opened.clear();
    this.fail(new DOMException("The vault search index was closed.", "AbortError"));
  }

  private assertOpen(): void {
    if (this.closed) throw new DOMException("The vault search index was closed.", "AbortError");
  }

  private fail(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.fault = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private call(
    request: Omit<Extract<SearchWorkerRequest, { type: "update" }>, "id"> |
      Omit<Extract<SearchWorkerRequest, { type: "query" }>, "id"> |
      Omit<Extract<SearchWorkerRequest, { type: "opened" }>, "id">,
  ): Promise<SearchWorkerResult[] | null> {
    this.assertOpen();
    if (this.fault) return Promise.reject(this.fault);
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/search.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
        const pending = this.pending.get(event.data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(event.data.id);
        if ("error" in event.data) {
          pending.reject(event.data.cancelled
            ? new DOMException(event.data.error, "AbortError") : new Error(event.data.error));
        } else pending.resolve(event.data.value);
      };
      this.worker.onerror = (event) => this.fail(new Error(event.message || "The vault search worker failed."));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Vault search timed out.")), 60_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker!.postMessage({ ...request, id }); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
}
