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
    findControllers: [] as unknown[],
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
    _scrollMatches = false;
    _selected = { pageIdx: -1, matchIdx: -1 };
    constructor() {
      runtimeMock.findControllers.push(this);
    }
    get selected() {
      return this._selected;
    }
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
    runtimeMock.findControllers.length = 0;
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

  it("scrolls search matches only inside the PDF viewport", async () => {
    const outer = document.createElement("div");
    const container = document.createElement("div");
    const viewer = document.createElement("div");
    const match = document.createElement("span");
    outer.append(container);
    container.append(viewer);
    viewer.append(match);
    document.body.append(outer);

    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 400,
    });
    container.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 200,
        width: 400,
        height: 300,
      }) as DOMRect;
    match.getBoundingClientRect = () =>
      ({
        top: 250,
        left: 500,
        width: 50,
        height: 20,
      }) as DOMRect;
    outer.scrollTop = 42;
    outer.scrollLeft = 7;
    container.scrollTop = 10;
    container.scrollLeft = 20;

    const runtime = createPdfJsRuntime({
      container,
      viewer,
      callbacks: callbackMocks(),
    });
    const controller = runtimeMock.findControllers[
      runtimeMock.findControllers.length - 1
    ] as {
      _scrollMatches: boolean;
      _selected: { pageIdx: number; matchIdx: number };
      scrollMatchIntoView: (value: {
        element: HTMLElement;
        pageIndex: number;
        matchIndex: number;
      }) => void;
    };
    controller._scrollMatches = true;
    controller._selected = { pageIdx: 0, matchIdx: 0 };

    controller.scrollMatchIntoView({
      element: match,
      pageIndex: 0,
      matchIndex: 0,
    });

    expect(container.scrollTop).toBe(160);
    expect(container.scrollLeft).toBe(145);
    expect(outer.scrollTop).toBe(42);
    expect(outer.scrollLeft).toBe(7);
    expect(controller._scrollMatches).toBe(false);

    await runtime.destroy();
    outer.remove();
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
