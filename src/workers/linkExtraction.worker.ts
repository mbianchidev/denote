/// <reference lib="webworker" />

import { extractWebLinks } from "../lib/links";
import { extractHeadings } from "../lib/markdown";
import {
  buildSourceMinimap,
  extractSourceSymbols,
} from "../lib/sourceOutline";
import { analysisHasIncompleteHeading } from "../lib/outlineStability";
import type { CoreSyntaxLanguageId } from "../lib/syntaxLanguages";
import { wordCountLabel } from "../lib/documentStatistics";
import { createMarkdownParser } from "../lib/markdownParser";

interface LinkExtractionRequest {
  markdown: string;
  languageId: CoreSyntaxLanguageId | null;
  includeSourceOutline: boolean;
}

export type LinkExtractionResponse =
  | {
      wordCount: string;
      links: string[];
      headings: ReturnType<typeof extractHeadings>;
      incompleteHeading: boolean;
      symbols: ReturnType<typeof extractSourceSymbols>;
      minimap: ReturnType<typeof buildSourceMinimap>;
    }
  | { error: string };

self.onmessage = (event: MessageEvent<LinkExtractionRequest>) => {
  try {
    const parse = createMarkdownParser();
    const symbols = extractSourceSymbols(
      event.data.markdown,
      event.data.languageId,
    );
    self.postMessage({
      wordCount: wordCountLabel(event.data.markdown),
      links: extractWebLinks(event.data.markdown, parse),
      headings: extractHeadings(event.data.markdown, parse),
      incompleteHeading: analysisHasIncompleteHeading(
        event.data.markdown,
        event.data.includeSourceOutline,
      ),
      symbols,
      minimap: event.data.includeSourceOutline
        ? buildSourceMinimap(event.data.markdown, symbols)
        : [],
    } satisfies LinkExtractionResponse);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    } satisfies LinkExtractionResponse);
  }
};
