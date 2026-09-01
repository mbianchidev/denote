/// <reference lib="webworker" />

import { extractWebLinks } from "../lib/links";
import { extractHeadings } from "../lib/markdown";
import {
  buildSourceMinimap,
  extractSourceSymbols,
} from "../lib/sourceOutline";
import { hasIncompleteMarkdownHeading } from "../lib/outlineStability";
import type { CoreSyntaxLanguageId } from "../lib/syntaxLanguages";

interface LinkExtractionRequest {
  markdown: string;
  languageId: CoreSyntaxLanguageId | null;
  includeSourceOutline: boolean;
}

self.onmessage = (event: MessageEvent<LinkExtractionRequest>) => {
  try {
    const symbols = extractSourceSymbols(
      event.data.markdown,
      event.data.languageId,
    );
    self.postMessage({
      links: extractWebLinks(event.data.markdown),
      headings: extractHeadings(event.data.markdown),
      incompleteHeading: hasIncompleteMarkdownHeading(event.data.markdown),
      symbols,
      minimap: event.data.includeSourceOutline
        ? buildSourceMinimap(event.data.markdown, symbols)
        : [],
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
