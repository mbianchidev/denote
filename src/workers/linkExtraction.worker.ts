/// <reference lib="webworker" />

import { extractWebLinks } from "../lib/links";
import { extractHeadings } from "../lib/markdown";

interface LinkExtractionRequest {
  markdown: string;
}

self.onmessage = (event: MessageEvent<LinkExtractionRequest>) => {
  try {
    self.postMessage({
      links: extractWebLinks(event.data.markdown),
      headings: extractHeadings(event.data.markdown),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
