import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPdfFixture } from "../test/pdfFixtures";
import { defaultPdfViewState, type PdfRuntimeCallbacks } from "./pdf";

const runtimeMock = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  const task = {
    promise: Promise.resolve({}),
    destroy: vi.fn().mockResolvedValue(undefined),
    onProgress: null as ((event: { loaded: number; total?: number }) => void) | null,
    onPassword: null as
      | ((updatePassword: (password: string) => void, reason: number) => void)
      | null,
  };
  return {
    handlers,
    task,
    getDocument: vi.fn(() => task),
  };
});

vi.mock("pdfjs-dist", () => ({
  AnnotationEditorType: { DISABLE: -1 },
  AnnotationMode: { DISABLE: 0 },
  GlobalWorkerOptions: {},
  PasswordResponses: { INCORRECT_PASSWORD: 2 },
  VerbosityLevel: { ERRORS: 0 },
  getDocument: runtimeMock.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?worker&url", () => ({
  default: "/assets/pdf.worker.mjs",
}));

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => {
  class EventBus {
    on(name: string, handler: (event: unknown) => void) {
      runtimeMock.handlers.set(name, handler);
    }
    dispatch(name: string, event: unknown) {
      runtimeMock.handlers.get(name)?.(event);
    }
  }
  class PDFLinkService {
    externalLinkEnabled = true;
    setViewer() {}
    setDocument() {}
  }
  class PDFFindController {
    setDocument() {}
  }
  class PDFViewer {
    firstPagePromise = Promise.resolve();
    currentPageNumber = 1;
    currentScale = 1;
    currentScaleValue = "page-width";
    pagesRotation = 0;
    setDocument() {}
  }
  return {
    EventBus,
    FindState: { FOUND: 0, NOT_FOUND: 1, WRAPPED: 2, PENDING: 3 },
    PDFFindController,
    PDFLinkService,
    PDFViewer,
  };
});

import { createPdfJsRuntime } from "./pdfRuntime";

describe("PdfJsRuntime", () => {
  beforeEach(() => {
    runtimeMock.handlers.clear();
    runtimeMock.getDocument.mockClear();
    runtimeMock.task.destroy.mockClear();
    runtimeMock.task.onProgress = null;
    runtimeMock.task.onPassword = null;
  });

  it("uses real PDF.js event shapes and destroys fatal loading tasks", async () => {
    let rejectLoad: (error: Error) => void = () => {};
    runtimeMock.task.promise = new Promise((_, reject) => {
      rejectLoad = reject;
    });
    const callbacks = callbackMocks();
    const runtime = createPdfJsRuntime({
      container: document.createElement("div"),
      viewer: document.createElement("div"),
      callbacks,
    });

    const loading = runtime.load(createPdfFixture(), defaultPdfViewState());
    runtimeMock.task.onProgress?.({ loaded: 25, total: 100 });
    runtimeMock.handlers.get("textlayerrendered")?.({
      pageNumber: 1,
      source: {
        textLayer: {
          div: { textContent: "Synthetic selectable text" },
        },
      },
    });
    rejectLoad(
      Object.assign(new Error("Invalid PDF structure"), {
        name: "InvalidPDFException",
      }),
    );
    await loading;

    expect(callbacks.onProgress).toHaveBeenCalledWith(25);
    expect(callbacks.onPageTextChanged).toHaveBeenCalledWith({
      pageNumber: 1,
      available: true,
    });
    expect(runtimeMock.task.destroy).toHaveBeenCalledTimes(1);
    expect(callbacks.onFatalError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "InvalidPDFException" }),
    );
  });
});

function callbackMocks(): PdfRuntimeCallbacks {
  return {
    onProgress: vi.fn(),
    onLoaded: vi.fn(),
    onPageChanged: vi.fn(),
    onScaleChanged: vi.fn(),
    onRotationChanged: vi.fn(),
    onPageTextChanged: vi.fn(),
    onPasswordRequired: vi.fn(),
    onSearchChanged: vi.fn(),
    onRenderError: vi.fn(),
    onSearchError: vi.fn(),
    onFatalError: vi.fn(),
  };
}
