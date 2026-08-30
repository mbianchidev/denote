import type { SearchDocument } from "../types";

interface LinkRewriteUpdate {
  path: string;
  content: string;
}

export function computeLinkRewriteUpdates(
  documents: SearchDocument[],
  oldPath: string,
  newPath: string,
  availablePaths: string[],
): Promise<LinkRewriteUpdate[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/linkRewrite.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Updating Markdown links timed out"));
    }, 60_000);
    const finish = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = (
      event: MessageEvent<{
        updates?: LinkRewriteUpdate[];
        error?: string;
      }>,
    ) => {
      finish();
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.updates ?? []);
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Unable to update Markdown links"));
    };
    worker.postMessage({ documents, oldPath, newPath, availablePaths });
  });
}
