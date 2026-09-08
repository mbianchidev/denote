import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  classifyPdfBytes,
  defaultPdfViewState,
  isPdfPath,
  normalizePdfViewState,
  pdfAssetUrls,
  pdfProgressPercent,
  pdfTextLayerAvailable,
  releasePdfBytes,
  type PdfViewState,
} from "./pdf";
import {
  createCorruptPdfFixture,
  createPdfFixture,
} from "../test/pdfFixtures";

describe("PDF boundaries", () => {
  it("recognizes PDF paths without routing ordinary files differently", () => {
    expect(isPdfPath("docs/reference.pdf")).toBe(true);
    expect(isPdfPath("docs/REFERENCE.PDF")).toBe(true);
    expect(isPdfPath("docs/reference.pdf.txt")).toBe(false);
    expect(isPdfPath("docs/reference.md")).toBe(false);
  });

  it("distinguishes empty, corrupted, supported, and unsupported PDF versions", () => {
    expect(classifyPdfBytes(new Uint8Array())).toEqual({ kind: "empty" });
    expect(classifyPdfBytes(createCorruptPdfFixture())).toEqual({
      kind: "supported",
      version: "1.7",
    });
    expect(classifyPdfBytes(createPdfFixture())).toEqual({
      kind: "supported",
      version: "1.7",
    });
    expect(classifyPdfBytes(createPdfFixture(undefined, "9.9"))).toEqual({
      kind: "unsupported",
      version: "9.9",
    });
    expect(
      classifyPdfBytes(new TextEncoder().encode("not a PDF document")),
    ).toEqual({ kind: "corrupted" });
  });

  it("keeps view state bounded and byte-safe", () => {
    expect(
      normalizePdfViewState(
        {
          pageNumber: 99,
          scale: 12,
          scaleMode: "custom",
          rotation: 450 as PdfViewState["rotation"],
        },
        4,
      ),
    ).toEqual({
      pageNumber: 4,
      scale: 4,
      scaleMode: "custom",
      rotation: 90,
    });
    expect(normalizePdfViewState(defaultPdfViewState(), 0).pageNumber).toBe(1);

    const bytes = createPdfFixture();
    const encoded = bytesToBase64(bytes);
    expect(
      Array.from(
        Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)),
      ),
    ).toEqual(Array.from(bytes));
    releasePdfBytes(bytes);
    expect(bytes.every((value) => value === 0)).toBe(true);
  });

  it("resolves renderer assets only against the current application origin", () => {
    expect(pdfAssetUrls(new URL("tauri://localhost/index.html"))).toEqual({
      cMapUrl: "tauri://localhost/pdfjs-assets/cmaps/",
      standardFontDataUrl:
        "tauri://localhost/pdfjs-assets/standard_fonts/",
      wasmUrl: "tauri://localhost/pdfjs-assets/wasm/",
      iccUrl: "tauri://localhost/pdfjs-assets/iccs/",
    });
    expect(pdfAssetUrls(new URL("http://localhost:1420/")).cMapUrl).toBe(
      "http://localhost:1420/pdfjs-assets/cmaps/",
    );
    expect(pdfAssetUrls(new URL("http://tauri.localhost/")).cMapUrl).toBe(
      "http://tauri.localhost/pdfjs-assets/cmaps/",
    );
    expect(pdfAssetUrls(new URL("https://tauri.localhost/")).cMapUrl).toBe(
      "https://tauri.localhost/pdfjs-assets/cmaps/",
    );
    expect(() =>
      pdfAssetUrls(new URL("https://cdn.example.test/viewer")),
    ).toThrow(/local application origin/i);
  });

  it("uses the actual PDF.js progress and text-layer event shapes", () => {
    expect(pdfProgressPercent(50, 200)).toBe(25);
    expect(pdfProgressPercent(200, 100)).toBe(100);
    expect(pdfProgressPercent(10, undefined)).toBeNull();
    expect(
      pdfTextLayerAvailable({
        textLayer: { div: { textContent: "Synthetic selectable text" } },
      }),
    ).toBe(true);
    expect(
      pdfTextLayerAvailable({
        textLayer: { div: { textContent: "   " } },
      }),
    ).toBe(false);
  });
});
