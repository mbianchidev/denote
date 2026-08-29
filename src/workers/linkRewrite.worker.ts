/// <reference lib="webworker" />

import {
  createAvailablePathIndex,
  oldPathBeforeMove,
  rewriteMarkdownLinksAfterMove,
} from "../lib/linkRewriter";
import type { SearchDocument } from "../types";

interface LinkRewriteRequest {
  documents: SearchDocument[];
  oldPath: string;
  newPath: string;
  availablePaths: string[];
}

interface LinkRewriteUpdate {
  path: string;
  content: string;
}

self.onmessage = (event: MessageEvent<LinkRewriteRequest>) => {
  try {
    const { documents, oldPath, newPath, availablePaths } = event.data;
    const updates: LinkRewriteUpdate[] = [];
    const oldAvailablePaths = availablePaths.map((path) =>
      oldPathBeforeMove(path, oldPath, newPath),
    );
    const availablePathIndex = createAvailablePathIndex(oldAvailablePaths);
    for (const document of documents) {
      const oldSourcePath = oldPathBeforeMove(
        document.path,
        oldPath,
        newPath,
      );
      const content = rewriteMarkdownLinksAfterMove(
        document.content,
        oldSourcePath,
        document.path,
        oldPath,
        newPath,
        availablePathIndex,
      );
      if (content !== document.content) {
        updates.push({ path: document.path, content });
      }
    }
    self.postMessage({ updates });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
