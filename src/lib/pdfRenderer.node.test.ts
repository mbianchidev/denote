// @vitest-environment node

import {
  getDocument,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import {
  createCorruptPdfFixture,
  createImageOnlyPdfFixture,
  createLargePdfFixture,
  createPasswordPdfFixture,
  createPdfFixture,
} from "../test/pdfFixtures";

const standardFontDataUrl = new URL(
  "../../node_modules/pdfjs-dist/standard_fonts/",
  import.meta.url,
).href;

describe("PDF.js local renderer contract", () => {
  it("parses text, rotation, image-only, and large synthetic PDFs from bytes", async () => {
    const fetch = vi.fn(() =>
      Promise.reject(new Error("PDF byte loading must not use the network.")),
    );
    vi.stubGlobal("fetch", fetch);

    const textTask = getDocument({
      data: createPdfFixture([
        { text: "First synthetic page" },
        { text: "Rotated synthetic page", rotation: 90 },
      ]),
      isEvalSupported: false,
      enableXfa: false,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      standardFontDataUrl,
      verbosity: VerbosityLevel.ERRORS,
    } as Parameters<typeof getDocument>[0] & { isEvalSupported: boolean });
    const textDocument = await textTask.promise;
    expect(textDocument.numPages).toBe(2);
    const firstText = await (await textDocument.getPage(1)).getTextContent();
    expect(firstText.items.some((item) => "str" in item && item.str.includes("First synthetic"))).toBe(true);
    expect((await textDocument.getPage(2)).rotate).toBe(90);
    await textTask.destroy();

    const imageTask = getDocument({
      data: createImageOnlyPdfFixture(),
      isEvalSupported: false,
      enableXfa: false,
      standardFontDataUrl,
      verbosity: VerbosityLevel.ERRORS,
    } as Parameters<typeof getDocument>[0] & { isEvalSupported: boolean });
    const imageDocument = await imageTask.promise;
    expect((await (await imageDocument.getPage(1)).getTextContent()).items).toHaveLength(0);
    await imageTask.destroy();

    const largeTask = getDocument({
      data: createLargePdfFixture(),
      isEvalSupported: false,
      enableXfa: false,
      standardFontDataUrl,
      verbosity: VerbosityLevel.ERRORS,
    } as Parameters<typeof getDocument>[0] & { isEvalSupported: boolean });
    const largeDocument = await largeTask.promise;
    expect(largeDocument.numPages).toBe(600);
    expect((await largeDocument.getPage(600)).pageNumber).toBe(600);
    await largeTask.destroy();

    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports corrupted and password-protected synthetic PDFs explicitly", async () => {
    const corruptTask = getDocument({
      data: createCorruptPdfFixture(),
      verbosity: VerbosityLevel.ERRORS,
    });
    await expect(corruptTask.promise).rejects.toMatchObject({
      name: "InvalidPDFException",
    });
    await corruptTask.destroy();

    const protectedTask = getDocument({
      data: createPasswordPdfFixture(),
      verbosity: VerbosityLevel.ERRORS,
    });
    await expect(protectedTask.promise).rejects.toMatchObject({
      name: "PasswordException",
    });
    await protectedTask.destroy();

    const unlockedTask = getDocument({
      data: createPasswordPdfFixture(),
      password: "synthetic-password",
      verbosity: VerbosityLevel.ERRORS,
    });
    expect((await unlockedTask.promise).numPages).toBe(1);
    await unlockedTask.destroy();
  });
});
