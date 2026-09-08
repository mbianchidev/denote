import {
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  VerbosityLevel,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?worker&url";
import {
  EventBus,
  FindState,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  MAX_PDF_PAGES,
  MAX_SEARCHABLE_PDF_PAGES,
  pdfAssetUrls,
  pdfProgressPercent,
  pdfTextLayerAvailable,
  type PdfRuntime,
  type PdfRuntimeFactory,
  type PdfScaleMode,
  type PdfSearchState,
  type PdfViewState,
} from "./pdf";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const createPdfJsRuntime: PdfRuntimeFactory = ({
  container,
  viewer,
  callbacks,
}) => new PdfJsRuntime(container, viewer, callbacks);

class PdfJsRuntime implements PdfRuntime {
  private readonly abortController = new AbortController();
  private readonly eventBus = new EventBus();
  private readonly linkService = new PDFLinkService({
    eventBus: this.eventBus,
    ignoreDestinationZoom: true,
  });
  private readonly findController = new PDFFindController({
    eventBus: this.eventBus,
    linkService: this.linkService,
    updateMatchesCountOnProgress: true,
  });
  private readonly pdfViewer: PDFViewer;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private pdfDocument: PDFDocumentProxy | null = null;
  private lastSearchQuery = "";
  private destroyed = false;
  private passwordCancelled = false;

  constructor(
    container: HTMLDivElement,
    viewer: HTMLDivElement,
    private readonly callbacks: Parameters<PdfRuntimeFactory>[0]["callbacks"],
  ) {
    this.linkService.externalLinkEnabled = false;
    this.pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      annotationMode: AnnotationMode.DISABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      removePageBorders: true,
      maxCanvasPixels: 16 * 1024 * 1024,
      maxCanvasDim: 16_384,
      capCanvasAreaFactor: 150,
      enableDetailCanvas: true,
      enableOptimizedPartialRendering: true,
      enableSelectionRendering: true,
      imagesRightClickMinSize: -1,
      enablePermissions: true,
      supportsPinchToZoom: false,
      enableAutoLinking: false,
      abortSignal: this.abortController.signal,
    } as ConstructorParameters<typeof PDFViewer>[0] & {
      abortSignal: AbortSignal;
    });
    this.linkService.setViewer(this.pdfViewer);
    this.listen();
  }

  async load(data: Uint8Array, initialState: PdfViewState): Promise<void> {
    const assets = pdfAssetUrls(new URL(window.location.href));
    const task = getDocument({
      data,
      ...assets,
      cMapPacked: true,
      useWorkerFetch: true,
      useWasm: true,
      useSystemFonts: false,
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      maxImageSize: 32 * 1024 * 1024,
      canvasMaxAreaInBytes: 64 * 1024 * 1024,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      verbosity: VerbosityLevel.ERRORS,
    } as Parameters<typeof getDocument>[0] & {
      isEvalSupported: boolean;
    });
    this.loadingTask = task;
    task.onProgress = ({
      loaded,
      total,
    }: {
      loaded: number;
      total?: number;
    }) => {
      this.callbacks.onProgress(pdfProgressPercent(loaded, total));
    };
    task.onPassword = (
      updatePassword: (password: string) => void,
      reason: number,
    ) => {
      this.callbacks.onPasswordRequired({
        incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
        submit: (password) => updatePassword(password),
        cancel: () => {
          this.passwordCancelled = true;
          if (this.loadingTask === task) {
            this.loadingTask = null;
          }
          void task.destroy();
        },
      });
    };
    try {
      const document = await task.promise;
      if (this.destroyed) {
        await task.destroy();
        return;
      }
      if (document.numPages > MAX_PDF_PAGES) {
        const error = new Error(
          `This PDF has ${document.numPages} pages. Denote supports up to ${MAX_PDF_PAGES.toLocaleString()} pages per PDF.`,
        );
        error.name = "UnsupportedPdfError";
        await task.destroy();
        throw error;
      }
      this.pdfDocument = document;
      this.linkService.setDocument(document);
      this.pdfViewer.setDocument(document);
      await this.pdfViewer.firstPagePromise;
      if (this.destroyed || this.pdfDocument !== document) {
        return;
      }
      this.pdfViewer.pagesRotation = initialState.rotation;
      this.pdfViewer.currentScaleValue =
        initialState.scaleMode === "custom"
          ? String(initialState.scale)
          : initialState.scaleMode;
      this.pdfViewer.currentPageNumber = Math.min(
        Math.max(initialState.pageNumber, 1),
        document.numPages,
      );
      this.callbacks.onLoaded({ pageCount: document.numPages });
    } catch (error) {
      if (!this.destroyed && !this.passwordCancelled) {
        if (this.loadingTask === task) {
          this.loadingTask = null;
        }
        await task.destroy().catch(() => undefined);
        this.callbacks.onFatalError(error);
      }
    }
  }

  setPage(pageNumber: number): void {
    this.pdfViewer.currentPageNumber = pageNumber;
  }

  setScale(scale: number): void {
    this.pdfViewer.currentScale = scale;
  }

  setScaleMode(mode: Exclude<PdfScaleMode, "custom">): void {
    this.pdfViewer.currentScaleValue = mode;
  }

  setRotation(rotation: PdfViewState["rotation"]): void {
    this.pdfViewer.pagesRotation = rotation;
  }

  search(query: string, previous: boolean): void {
    if (!this.pdfDocument) {
      return;
    }
    if (this.pdfDocument.numPages > MAX_SEARCHABLE_PDF_PAGES) {
      this.callbacks.onSearchError(
        `Search is limited to PDFs with ${MAX_SEARCHABLE_PDF_PAGES} pages or fewer.`,
      );
      return;
    }
    try {
      const repeated = query === this.lastSearchQuery;
      this.lastSearchQuery = query;
      this.eventBus.dispatch("find", {
        source: this,
        type: repeated ? "again" : "",
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: previous,
        matchDiacritics: true,
      });
    } catch (error) {
      this.callbacks.onSearchError(errorMessage(error));
    }
  }

  clearSearch(): void {
    this.lastSearchQuery = "";
    this.eventBus.dispatch("findbarclose", { source: this });
    this.callbacks.onSearchChanged({
      state: "idle",
      current: 0,
      total: 0,
      message: "PDF search cleared",
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.abortController.abort();
    this.pdfViewer.setDocument(null as never);
    this.findController.setDocument(null as never);
    this.linkService.setDocument(null as never);
    const task = this.loadingTask;
    this.loadingTask = null;
    this.pdfDocument = null;
    if (task) {
      await task.destroy().catch(() => undefined);
    }
  }

  private listen(): void {
    const options = { signal: this.abortController.signal };
    this.eventBus.on(
      "pagechanging",
      (event: { pageNumber: number }) =>
        this.callbacks.onPageChanged(event.pageNumber),
      options,
    );
    this.eventBus.on(
      "scalechanging",
      (event: { scale: number; presetValue?: string }) => {
        const scaleMode: PdfScaleMode =
          event.presetValue === "page-fit" || event.presetValue === "page-width"
            ? event.presetValue
            : "custom";
        this.callbacks.onScaleChanged({ scale: event.scale, scaleMode });
      },
      options,
    );
    this.eventBus.on(
      "rotationchanging",
      (event: { pagesRotation: number }) =>
        this.callbacks.onRotationChanged(
          event.pagesRotation as PdfViewState["rotation"],
        ),
      options,
    );
    this.eventBus.on(
      "textlayerrendered",
      (event: {
        pageNumber: number;
        source?: {
          textLayer?: {
            div?: HTMLElement;
          };
        };
        error?: unknown;
      }) => {
        if (event.error) {
          this.callbacks.onRenderError(
            `Page ${event.pageNumber} text could not be rendered.`,
          );
          return;
        }
        this.callbacks.onPageTextChanged({
          pageNumber: event.pageNumber,
          available: pdfTextLayerAvailable(event.source),
        });
      },
      options,
    );
    this.eventBus.on(
      "pagerendered",
      (event: { pageNumber: number; error?: unknown }) => {
        if (event.error) {
          this.callbacks.onRenderError(
            `Page ${event.pageNumber} could not be rendered. ${errorMessage(event.error)}`,
          );
        }
      },
      options,
    );
    this.eventBus.on(
      "updatefindcontrolstate",
      (event: {
        state: number;
        matchesCount?: { current?: number; total?: number };
      }) => {
        const current = event.matchesCount?.current ?? 0;
        const total = event.matchesCount?.total ?? 0;
        let state: PdfSearchState["state"] = "found";
        let message =
          total > 0
            ? `Result ${current} of ${total}`
            : "No matches; this PDF may not contain searchable text.";
        if (event.state === FindState.PENDING) {
          state = "searching";
          message = "Searching PDF…";
        } else if (event.state === FindState.NOT_FOUND) {
          state = "not-found";
        } else if (event.state === FindState.WRAPPED) {
          message =
            total > 0
              ? `Wrapped to result ${current} of ${total}`
              : "No matches; this PDF may not contain searchable text.";
        }
        this.callbacks.onSearchChanged({ state, current, total, message });
      },
      options,
    );
    this.eventBus.on(
      "updatefindmatchescount",
      (event: { matchesCount?: { current?: number; total?: number } }) => {
        const current = event.matchesCount?.current ?? 0;
        const total = event.matchesCount?.total ?? 0;
        this.callbacks.onSearchChanged({
          state: total > 0 ? "found" : "searching",
          current,
          total,
          message: total > 0 ? `Result ${current} of ${total}` : "Searching PDF…",
        });
      },
      options,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
