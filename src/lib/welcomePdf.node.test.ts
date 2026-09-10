// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getDocument,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";

const standardFontDataUrl = new URL(
  "../../node_modules/pdfjs-dist/standard_fonts/",
  import.meta.url,
).href;

describe("Welcome PDF", () => {
  it("opens locally in the core PDF reader contract without network access", async () => {
    const fetch = vi.fn(() =>
      Promise.reject(new Error("Synthetic PDF loading must stay local.")),
    );
    vi.stubGlobal("fetch", fetch);
    const bytes = readFileSync(
      join(process.cwd(), "docs/user-guide/examples/Hello document.pdf"),
    );
    const task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      enableXfa: false,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      standardFontDataUrl,
      verbosity: VerbosityLevel.ERRORS,
    } as Parameters<typeof getDocument>[0] & { isEvalSupported: boolean });

    const document = await task.promise;
    expect(document.numPages).toBe(1);
    const text = await (await document.getPage(1)).getTextContent();
    const extracted = text.items
      .filter((item) => "str" in item)
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(extracted).toContain("Hello document");
    expect(extracted).toContain("Synthetic local PDF.");
    expect(fetch).not.toHaveBeenCalled();
    await task.destroy();
    vi.unstubAllGlobals();
  });
});
