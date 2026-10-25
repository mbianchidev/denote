/// <reference lib="webworker" />

import { VaultSearchIndex } from "../lib/search";
import type { SearchWorkerRequest, SearchWorkerResponse } from "../lib/searchWorker";

const index = new VaultSearchIndex();
let tail: Promise<unknown> = Promise.resolve();
let queryVersion = 0;
self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const request = event.data;
  const version = request.type === "query" || request.type === "update" ? ++queryVersion : queryVersion;
  const operation = tail.catch(() => undefined).then(async () => {
    if (request.type === "query") {
      const results = await index.query(request.request, () => version !== queryVersion);
      return results.map(({ document, ...result }) => ({ ...result, path: document.path }));
    }
    if (request.type === "update") await index.update(request.documents, request.removedPaths);
    else index.recordOpen(request.path, request.lastOpenedAt);
    return null;
  });
  tail = operation;
  void operation.then(
    (value) => self.postMessage({ id: request.id, value } satisfies SearchWorkerResponse),
    (error: unknown) => self.postMessage({
      id: request.id, error: error instanceof Error ? error.message : String(error),
      cancelled: error instanceof Error && error.name === "AbortError",
    } satisfies SearchWorkerResponse),
  );
};
