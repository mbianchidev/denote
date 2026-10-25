import type { DocumentBatch, FileNode, SearchDocument } from "../types";
import { sameSearchContent } from "./search";

export const MAX_VAULT_SEARCH_BYTES = 64 * 1024 * 1024;
const byteSizes = new WeakMap<SearchDocument, { content: string; size: number }>();

export function searchDocumentBytes(document: SearchDocument): number {
  const known = byteSizes.get(document);
  if (known?.content === document.content) return known.size;
  const size = document.contentBytes ?? new TextEncoder().encode(document.content).length;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Search document has an invalid byte count.");
  byteSizes.set(document, { content: document.content, size });
  return size;
}

export function pathInRegions(path: string, regions: readonly string[]): boolean {
  return regions.some((region) => path === region || path.startsWith(`${region}/`));
}

export async function readSearchSnapshot(
  tree: readonly FileNode[],
  read: (paths: string[], maxBytes: number) => Promise<DocumentBatch>,
  current: () => boolean,
): Promise<DocumentBatch> {
  const result: DocumentBatch = { documents: [], skippedCount: 0, skippedPaths: [], truncated: false };
  const stack = [...tree].reverse();
  let paths: string[] = [];
  let estimate = 0;
  let bytes = 0;
  const flush = async () => {
    if (!current()) throw new DOMException("The vault index changed.", "AbortError");
    const batch = await read(paths, Math.max(0, MAX_VAULT_SEARCH_BYTES - bytes));
    if (!current()) throw new DOMException("The vault index changed.", "AbortError");
    for (const document of batch.documents) {
      bytes += searchDocumentBytes(document);
      if (bytes > MAX_VAULT_SEARCH_BYTES) throw new Error("Native search batch exceeded its byte budget.");
      result.documents.push(document);
    }
    result.skippedCount += batch.skippedCount;
    result.skippedPaths?.push(...batch.skippedPaths ?? []);
    result.truncated ||= batch.truncated;
    paths = [];
    estimate = 0;
  };
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "folder") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
      continue;
    }
    if (node.kind === "pdf") continue;
    const size = Math.max(0, node.size ?? 0) * 4 / 3;
    if (paths.length && (paths.length >= 128 || estimate + size > 512 * 1024)) {
      await flush();
      if (result.truncated) return result;
    }
    paths.push(node.path);
    estimate += size;
  }
  if (paths.length) await flush();
  return result;
}

function sameDocument(left: SearchDocument, right: SearchDocument): boolean {
  return sameSearchContent(left, right) && left.kind === right.kind &&
    left.encoding === right.encoding && left.lineEnding === right.lineEnding &&
    left.bookmarked === right.bookmarked && left.lastOpenedAt === right.lastOpenedAt &&
    left.createdAt === right.createdAt && left.modifiedAt === right.modifiedAt;
}

export class VaultSearchDocuments {
  private documents = new Map<string, SearchDocument>();
  private skipped = new Set<string>();
  private unknownSkipped = 0;
  private truncated = false;
  private changes = 0;
  private removed = new Map<string, number>();
  private opened = new Map<string, string | null>();
  private current: DocumentBatch = { documents: [], skippedCount: 0, skippedPaths: [], truncated: false };

  constructor(private readonly limit = MAX_VAULT_SEARCH_BYTES) {}
  get snapshot(): DocumentBatch { return this.current; }
  get revision(): number { return this.changes; }

  availableBytes(regions: readonly string[]): number {
    let retained = 0;
    for (const document of this.documents.values()) {
      if (!pathInRegions(document.path, regions)) retained += searchDocumentBytes(document);
    }
    return Math.max(0, this.limit - retained);
  }

  replace(batch: DocumentBatch, startedAt = this.changes): DocumentBatch {
    const concurrent = [...this.removed].filter(([, revision]) => revision > startedAt);
    const filtered = { ...batch, documents: batch.documents.filter((document) =>
      !pathInRegions(document.path, concurrent.map(([path]) => path))) };
    const result = this.install(new Map(), filtered, new Set(batch.skippedPaths),
      Math.max(0, batch.skippedCount - (batch.skippedPaths?.length ?? 0)), batch.truncated);
    this.removed = new Map(concurrent);
    return result;
  }

  update(regions: readonly string[], batch: DocumentBatch, startedAt = this.changes): DocumentBatch {
    if (batch.documents.some((document) => !pathInRegions(document.path, regions))) {
      throw new Error("A scoped search update returned an unrelated path.");
    }
    const documents = new Map(this.documents);
    const incoming = new Set(batch.documents.map((document) => document.path));
    for (const path of documents.keys()) if (pathInRegions(path, regions) && !incoming.has(path)) documents.delete(path);
    const skipped = new Set([...this.skipped].filter((path) => !pathInRegions(path, regions)));
    for (const path of batch.skippedPaths ?? []) skipped.add(path);
    const concurrent = [...this.removed].filter(([, revision]) => revision > startedAt).map(([path]) => path);
    const filtered = { ...batch, documents: batch.documents.filter((document) => !pathInRegions(document.path, concurrent)) };
    return this.install(documents, filtered, skipped,
      Math.max(this.unknownSkipped, batch.skippedCount - (batch.skippedPaths?.length ?? 0)),
      this.truncated || batch.truncated);
  }

  recordOpen(path: string, lastOpenedAt: string | null): DocumentBatch {
    this.opened.set(path, lastOpenedAt);
    const document = this.documents.get(path);
    if (document && document.lastOpenedAt !== lastOpenedAt) {
      this.documents.set(path, { ...document, lastOpenedAt });
      this.publish();
    }
    return this.current;
  }

  removePaths(remove: (path: string) => boolean): DocumentBatch {
    for (const path of this.documents.keys()) if (remove(path)) this.documents.delete(path);
    for (const path of this.skipped) if (remove(path)) this.skipped.delete(path);
    for (const path of this.opened.keys()) if (remove(path)) this.opened.delete(path);
    this.publish();
    return this.current;
  }

  removeRegions(regions: readonly string[]): DocumentBatch {
    const revision = ++this.changes;
    for (const path of regions) this.removed.set(path, revision);
    return this.removePaths((path) => pathInRegions(path, regions));
  }

  private install(
    documents: Map<string, SearchDocument>, batch: DocumentBatch, skipped: Set<string>,
    unknownSkipped: number, truncated: boolean,
  ): DocumentBatch {
    for (const incoming of batch.documents) {
      const document = this.opened.has(incoming.path)
        ? { ...incoming, lastOpenedAt: this.opened.get(incoming.path) ?? null } : incoming;
      const previous = this.documents.get(document.path);
      documents.set(document.path, previous && sameDocument(previous, document) ? previous : document);
    }
    let bytes = 0;
    for (const document of documents.values()) bytes += searchDocumentBytes(document);
    if (bytes > this.limit) throw new Error("Search update exceeds the vault byte budget.");
    this.documents = documents;
    this.skipped = skipped;
    this.unknownSkipped = unknownSkipped;
    this.truncated = truncated;
    this.publish();
    return this.current;
  }

  private publish(): void {
    const documents = [...this.documents.values()];
    const skippedCount = this.unknownSkipped + this.skipped.size;
    if (documents.length === this.current.documents.length &&
      documents.every((document, index) => document === this.current.documents[index]) &&
      skippedCount === this.current.skippedCount && this.truncated === this.current.truncated) return;
    this.current = { documents, skippedPaths: [...this.skipped], skippedCount, truncated: this.truncated };
  }
}
