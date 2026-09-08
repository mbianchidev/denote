import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  MAX_PDF_SCALE,
  MAX_SEARCHABLE_PDF_PAGES,
  MIN_PDF_SCALE,
  PDF_SCALE_STEP,
  clampPdfScale,
  classifyPdfBytes,
  normalizePdfViewState,
  pdfFatalErrorMessage,
  releasePdfBytes,
  type PdfPasswordChallenge,
  type PdfReaderCommand,
  type PdfRuntime,
  type PdfRuntimeCallbacks,
  type PdfRuntimeFactory,
  type PdfSearchState,
  type PdfViewState,
} from "../lib/pdf";

interface PdfReaderProps {
  title: string;
  data: Uint8Array;
  viewState: PdfViewState;
  searchFocusRequest: number;
  command?: PdfReaderCommand;
  onViewStateChange: (state: PdfViewState) => void;
  createRuntime?: PdfRuntimeFactory;
}

type LoadState =
  | { kind: "loading"; percent: number | null }
  | { kind: "ready" }
  | { kind: "fatal"; message: string };

const IDLE_SEARCH: PdfSearchState = {
  state: "idle",
  current: 0,
  total: 0,
  message: "Search this PDF",
};

export function PdfReader({
  title,
  data,
  viewState,
  searchFocusRequest,
  command,
  onViewStateChange,
  createRuntime,
}: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PdfRuntime | null>(null);
  const viewStateRef = useRef(viewState);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordDialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const handledCommand = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>({
    kind: "loading",
    percent: null,
  });
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(viewState.pageNumber);
  const [scale, setScale] = useState(viewState.scale);
  const [scaleMode, setScaleMode] = useState(viewState.scaleMode);
  const [rotation, setRotation] = useState(viewState.rotation);
  const [passwordChallenge, setPasswordChallenge] =
    useState<PdfPasswordChallenge | null>(null);
  const [searchState, setSearchState] = useState(IDLE_SEARCH);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pageTextAvailable, setPageTextAvailable] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  }, [onViewStateChange]);

  useEffect(() => {
    if (searchFocusRequest > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchFocusRequest]);

  useEffect(() => {
    if (
      !command ||
      loadState.kind !== "ready" ||
      command.request === handledCommand.current
    ) {
      return;
    }
    handledCommand.current = command.request;
    if (command.action === "zoom-in") {
      runtimeRef.current?.setScale(clampPdfScale(scale + PDF_SCALE_STEP));
    } else if (command.action === "zoom-out") {
      runtimeRef.current?.setScale(clampPdfScale(scale - PDF_SCALE_STEP));
    } else {
      runtimeRef.current?.setScale(1);
    }
  }, [command, loadState.kind, scale]);

  useEffect(() => {
    if (passwordChallenge) {
      passwordInputRef.current?.focus();
    }
  }, [passwordChallenge]);

  useEffect(() => {
    const classification = classifyPdfBytes(data);
    if (classification.kind === "empty") {
      setLoadState({ kind: "fatal", message: "This PDF is empty." });
      return;
    }
    if (classification.kind === "corrupted") {
      setLoadState({
        kind: "fatal",
        message: "This PDF is corrupted or does not contain a PDF header.",
      });
      return;
    }
    if (classification.kind === "unsupported") {
      setLoadState({
        kind: "fatal",
        message: `PDF version ${classification.version} is not supported. Denote supports PDF versions 1.0 through 2.0.`,
      });
      return;
    }
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) {
      return;
    }

    let active = true;
    let runtime: PdfRuntime | null = null;
    const runtimeBytes = data.slice();
    setLoadState({ kind: "loading", percent: null });
    setPageCount(0);
    setRenderError(null);
    setSearchError(null);
    setSearchState(IDLE_SEARCH);
    setPageTextAvailable(null);
    setPasswordChallenge(null);

    const callbacks: PdfRuntimeCallbacks = {
      onProgress: (percent) => {
        if (active) {
          setLoadState({ kind: "loading", percent });
        }
      },
      onLoaded: ({ pageCount: loadedPageCount }) => {
        if (!active) {
          return;
        }
        const normalized = normalizePdfViewState(
          viewStateRef.current,
          loadedPageCount,
        );
        setPageCount(loadedPageCount);
        setCurrentPage(normalized.pageNumber);
        setScale(normalized.scale);
        setScaleMode(normalized.scaleMode);
        setRotation(normalized.rotation);
        setLoadState({ kind: "ready" });
      },
      onPageChanged: (pageNumber) => {
        if (!active) {
          return;
        }
        setCurrentPage(pageNumber);
        publishViewState({ pageNumber });
      },
      onScaleChanged: (value) => {
        if (!active) {
          return;
        }
        setScale(value.scale);
        setScaleMode(value.scaleMode);
        publishViewState(value);
      },
      onRotationChanged: (nextRotation) => {
        if (!active) {
          return;
        }
        setRotation(nextRotation);
        publishViewState({ rotation: nextRotation });
      },
      onPageTextChanged: ({ pageNumber, available }) => {
        if (active && pageNumber === currentPageRef()) {
          setPageTextAvailable(available);
        }
      },
      onPasswordRequired: (challenge) => {
        if (active) {
          setPasswordChallenge(challenge);
        }
      },
      onSearchChanged: (state) => {
        if (active) {
          setSearchError(null);
          setSearchState(state);
        }
      },
      onRenderError: (message) => {
        if (active) {
          setRenderError(message);
        }
      },
      onSearchError: (message) => {
        if (active) {
          setSearchError(message);
        }
      },
      onFatalError: (error) => {
        if (active) {
          setPasswordChallenge(null);
          setLoadState({ kind: "fatal", message: pdfFatalErrorMessage(error) });
        }
      },
    };

    void (async () => {
      const factory =
        createRuntime ??
        (await import("../lib/pdfRuntime")).createPdfJsRuntime;
      if (!active) {
        releasePdfBytes(runtimeBytes);
        return;
      }
      runtime = factory({ container, viewer, callbacks });
      runtimeRef.current = runtime;
      await runtime.load(runtimeBytes, viewStateRef.current);
    })().catch((error) => {
      if (active) {
        setLoadState({ kind: "fatal", message: pdfFatalErrorMessage(error) });
      }
    });

    return () => {
      active = false;
      setPasswordChallenge(null);
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
      void runtime?.destroy().finally(() => releasePdfBytes(runtimeBytes));
    };

    function currentPageRef(): number {
      return viewStateRef.current.pageNumber;
    }

    function publishViewState(update: Partial<PdfViewState>) {
      const next = { ...viewStateRef.current, ...update };
      viewStateRef.current = next;
      onViewStateChangeRef.current(next);
    }
  }, [createRuntime, data]);

  const ready = loadState.kind === "ready";
  const searchable =
    ready &&
    pageCount > 0 &&
    pageCount <= MAX_SEARCHABLE_PDF_PAGES &&
    !(pageCount === 1 && pageTextAvailable === false);
  const status =
    loadState.kind === "loading"
      ? loadState.percent === null
        ? "Loading PDF…"
        : `Loading PDF… ${Math.round(loadState.percent)}%`
      : loadState.kind === "fatal"
        ? loadState.message
        : searchError ??
          renderError ??
          (pageTextAvailable === false
            ? "This page has no selectable text."
            : searchState.state === "idle"
              ? `Page ${currentPage} of ${pageCount}`
              : searchState.message);

  const setPage = (pageNumber: number) => {
    if (!ready || pageCount === 0) {
      return;
    }
    runtimeRef.current?.setPage(
      Math.min(Math.max(Math.trunc(pageNumber) || 1, 1), pageCount),
    );
  };

  const setCustomScale = (nextScale: number) => {
    runtimeRef.current?.setScale(clampPdfScale(nextScale));
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    const input = passwordInputRef.current;
    const password = input?.value ?? "";
    if (!password || !passwordChallenge) {
      return;
    }
    if (input) {
      input.value = "";
    }
    const challenge = passwordChallenge;
    setPasswordChallenge(null);
    setLoadState({ kind: "loading", percent: null });
    containerRef.current?.focus();
    challenge.submit(password);
  };

  const cancelPassword = () => {
    passwordChallenge?.cancel();
    if (passwordInputRef.current) {
      passwordInputRef.current.value = "";
    }
    setPasswordChallenge(null);
    setLoadState({
      kind: "fatal",
      message:
        "This PDF is password-protected. Enter its password to open it, or close the tab.",
    });
    window.setTimeout(() => containerRef.current?.focus(), 0);
  };

  const runSearch = (previous: boolean) => {
    const query = searchInputRef.current?.value.trim() ?? "";
    if (!query) {
      runtimeRef.current?.clearSearch();
      setSearchState(IDLE_SEARCH);
      return;
    }
    if (!searchable) {
      setSearchError(
        pageCount > MAX_SEARCHABLE_PDF_PAGES
          ? `Search is limited to PDFs with ${MAX_SEARCHABLE_PDF_PAGES} pages or fewer.`
          : "This PDF has no searchable text layer.",
      );
      return;
    }
    setSearchError(null);
    setSearchState({
      state: "searching",
      current: 0,
      total: 0,
      message: "Searching PDF…",
    });
    runtimeRef.current?.search(query, previous);
  };

  const clearSearch = () => {
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
      searchInputRef.current.focus();
    }
    runtimeRef.current?.clearSearch();
    setSearchError(null);
    setSearchState(IDLE_SEARCH);
  };

  return (
    <section
      className="pdf-reader"
      role="region"
      aria-label={`PDF reader for ${title}`}
    >
      <div className="pdf-reader__toolbar" role="toolbar" aria-label="PDF controls">
        <div className="pdf-reader__control-group">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous PDF page"
            title="Previous page"
            disabled={!ready || currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
          <label className="pdf-reader__page-field">
            <span className="sr-only">PDF page number</span>
            <input
              type="number"
              min={1}
              max={Math.max(pageCount, 1)}
              value={currentPage}
              disabled={!ready}
              aria-label="PDF page number"
              onChange={(event) => setCurrentPage(Number(event.target.value))}
              onBlur={() => setPage(currentPage)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setPage(currentPage);
                }
              }}
            />
            <span aria-hidden="true">/ {Math.max(pageCount, 1)}</span>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label="Next PDF page"
            title="Next page"
            disabled={!ready || currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="pdf-reader__control-group">
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom PDF out"
            title="Zoom out"
            disabled={!ready || scale <= MIN_PDF_SCALE}
            onClick={() => setCustomScale(scale - PDF_SCALE_STEP)}
          >
            <ZoomOut aria-hidden="true" size={16} />
          </button>
          <span className="pdf-reader__zoom" aria-label="PDF zoom">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom PDF in"
            title="Zoom in"
            disabled={!ready || scale >= MAX_PDF_SCALE}
            onClick={() => setCustomScale(scale + PDF_SCALE_STEP)}
          >
            <ZoomIn aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            className="pdf-reader__text-button"
            aria-label="Fit PDF to width"
            aria-pressed={scaleMode === "page-width"}
            disabled={!ready}
            onClick={() => runtimeRef.current?.setScaleMode("page-width")}
          >
            Fit width
          </button>
          <button
            type="button"
            className="pdf-reader__text-button"
            aria-label="Fit PDF to page"
            aria-pressed={scaleMode === "page-fit"}
            disabled={!ready}
            onClick={() => runtimeRef.current?.setScaleMode("page-fit")}
          >
            <Maximize aria-hidden="true" size={14} />
            Fit page
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Rotate PDF clockwise"
            title="Rotate clockwise"
            disabled={!ready}
            onClick={() =>
              runtimeRef.current?.setRotation(
                ((rotation + 90) % 360) as PdfViewState["rotation"],
              )
            }
          >
            <RotateCw aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="pdf-reader__search" role="search">
          <Search aria-hidden="true" size={14} />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search this PDF"
            placeholder="Search this PDF"
            disabled={!ready}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runSearch(event.shiftKey);
              } else if (event.key === "Escape") {
                clearSearch();
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Previous PDF search result"
            title="Previous result"
            disabled={!searchable}
            onClick={() => runSearch(true)}
          >
            <ChevronLeft aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next PDF search result"
            title="Next result"
            disabled={!searchable}
            onClick={() => runSearch(false)}
          >
            <ChevronRight aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Clear PDF search"
            title="Clear search"
            disabled={!ready}
            onClick={clearSearch}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      </div>

      {pageCount > MAX_SEARCHABLE_PDF_PAGES ? (
        <p className="pdf-reader__limitation">
          Search is limited to PDFs with {MAX_SEARCHABLE_PDF_PAGES} pages or
          fewer. Page viewing remains lazy and available.
        </p>
      ) : null}
      {pageTextAvailable === false ? (
        <p className="pdf-reader__limitation">
          This page has no selectable text.
        </p>
      ) : null}
      {renderError ? (
        <p className="pdf-reader__error">{renderError}</p>
      ) : null}
      {searchError ? (
        <p className="pdf-reader__error">{searchError}</p>
      ) : null}

      <div className="pdf-reader__body">
        <div
          ref={containerRef}
          className="pdf-reader__viewport"
          tabIndex={0}
          aria-label={`PDF pages for ${title}`}
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>

        {loadState.kind !== "ready" ? (
          <div className="pdf-reader__state">
            <strong>
              {loadState.kind === "loading"
                ? "Loading PDF"
                : "Unable to open PDF"}
            </strong>
            <p>{status}</p>
          </div>
        ) : null}

        {passwordChallenge ? (
          <div className="pdf-reader__password-overlay">
            <div
              ref={passwordDialogRef}
              className="pdf-reader__password-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pdf-password-title"
              aria-describedby="pdf-password-description"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelPassword();
                  return;
                }
                if (event.key !== "Tab") {
                  return;
                }
                const controls =
                  passwordDialogRef.current?.querySelectorAll<HTMLElement>(
                    "input, button",
                  );
                if (!controls || controls.length === 0) {
                  return;
                }
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
            >
              <form onSubmit={submitPassword}>
                <h2 id="pdf-password-title">Unlock PDF</h2>
                <p id="pdf-password-description">
                  {passwordChallenge.incorrect
                    ? "That password did not unlock this PDF. Try again."
                    : "This PDF is password-protected. Its password stays in memory only for this local attempt."}
                </p>
                <label>
                  PDF password
                  <input
                    ref={passwordInputRef}
                    type="password"
                    autoComplete="off"
                    aria-label="PDF password"
                  />
                </label>
                <div className="pdf-reader__password-actions">
                  <button type="button" onClick={cancelPassword}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button">
                    Unlock
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </section>
  );
}
