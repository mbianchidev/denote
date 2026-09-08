export const MAX_PDF_PAGES = 5_000;
export const MAX_SEARCHABLE_PDF_PAGES = 500;
export const MIN_PDF_SCALE = 0.25;
export const MAX_PDF_SCALE = 4;
export const PDF_SCALE_STEP = 0.1;

export type PdfScaleMode = "custom" | "page-width" | "page-fit";

export interface PdfViewState {
  pageNumber: number;
  scale: number;
  scaleMode: PdfScaleMode;
  rotation: 0 | 90 | 180 | 270;
}

export interface PdfRuntimeCallbacks {
  onProgress: (percent: number | null) => void;
  onLoaded: (document: { pageCount: number }) => void;
  onPageChanged: (pageNumber: number) => void;
  onScaleChanged: (value: {
    scale: number;
    scaleMode: PdfScaleMode;
  }) => void;
  onRotationChanged: (rotation: PdfViewState["rotation"]) => void;
  onPageTextChanged: (value: {
    pageNumber: number;
    available: boolean;
  }) => void;
  onPasswordRequired: (challenge: PdfPasswordChallenge) => void;
  onSearchChanged: (state: PdfSearchState) => void;
  onRenderError: (message: string) => void;
  onSearchError: (message: string) => void;
  onFatalError: (error: unknown) => void;
}

export interface PdfRuntimeFactoryOptions {
  container: HTMLDivElement;
  viewer: HTMLDivElement;
  callbacks: PdfRuntimeCallbacks;
}

export interface PdfRuntime {
  load(data: Uint8Array, initialState: PdfViewState): Promise<void>;
  setPage(pageNumber: number): void;
  setScale(scale: number): void;
  setScaleMode(mode: Exclude<PdfScaleMode, "custom">): void;
  setRotation(rotation: PdfViewState["rotation"]): void;
  search(query: string, previous: boolean): void;
  clearSearch(): void;
  destroy(): Promise<void>;
}

export type PdfRuntimeFactory = (
  options: PdfRuntimeFactoryOptions,
) => PdfRuntime;

export interface PdfPasswordChallenge {
  incorrect: boolean;
  submit: (password: string) => void;
  cancel: () => void;
}

export interface PdfSearchState {
  state: "idle" | "searching" | "found" | "not-found";
  current: number;
  total: number;
  message: string;
}

export interface PdfReaderCommand {
  request: number;
  action: "zoom-in" | "zoom-out" | "zoom-reset";
}

export type PdfByteClassification =
  | { kind: "empty" }
  | { kind: "corrupted" }
  | { kind: "supported"; version: string }
  | { kind: "unsupported"; version: string };

export function isPdfPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith(".pdf");
}

export function classifyPdfBytes(data: Uint8Array): PdfByteClassification {
  if (data.byteLength === 0) {
    return { kind: "empty" };
  }
  const header = new TextDecoder("latin1").decode(data.subarray(0, 1_024));
  const version = header.match(/%PDF-(\d+)\.(\d+)/);
  if (!version) {
    return { kind: "corrupted" };
  }
  const major = Number(version[1]);
  const minor = Number(version[2]);
  const value = `${major}.${minor}`;
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    major < 1 ||
    major > 2 ||
    (major === 2 && minor > 0)
  ) {
    return { kind: "unsupported", version: value };
  }
  return { kind: "supported", version: value };
}

export function defaultPdfViewState(): PdfViewState {
  return {
    pageNumber: 1,
    scale: 1,
    scaleMode: "page-width",
    rotation: 0,
  };
}

export function normalizePdfViewState(
  state: PdfViewState,
  pageCount: number,
): PdfViewState {
  const normalizedRotation = (((state.rotation % 360) + 360) % 360) as number;
  const rotation =
    normalizedRotation === 90 ||
    normalizedRotation === 180 ||
    normalizedRotation === 270
      ? normalizedRotation
      : 0;
  return {
    pageNumber: Math.min(Math.max(Math.trunc(state.pageNumber) || 1, 1), Math.max(pageCount, 1)),
    scale: clampPdfScale(state.scale),
    scaleMode:
      state.scaleMode === "page-fit" || state.scaleMode === "page-width"
        ? state.scaleMode
        : "custom",
    rotation,
  };
}

export function clampPdfScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(
    Math.max(Math.round(scale * 100) / 100, MIN_PDF_SCALE),
    MAX_PDF_SCALE,
  );
}

export function decodeBase64Bytes(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  return Uint8Array.from(atob(compact), (character) =>
    character.charCodeAt(0),
  );
}

export function bytesToBase64(data: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function releasePdfBytes(data: Uint8Array | undefined): void {
  if (!data || data.byteLength === 0) {
    return;
  }
  try {
    data.fill(0);
  } catch {
    // A transferred buffer is already detached from this JavaScript context.
  }
}

export function pdfProgressPercent(
  loaded: number,
  total: number | undefined,
): number | null {
  if (!Number.isFinite(loaded) || !total || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.min(Math.max((loaded / total) * 100, 0), 100);
}

export function pdfTextLayerAvailable(source: {
  textLayer?: { div?: Pick<HTMLElement, "textContent"> };
} | null | undefined): boolean {
  return (source?.textLayer?.div?.textContent?.trim().length ?? 0) > 0;
}

export function pdfAssetUrls(baseUrl: URL): {
  cMapUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
  iccUrl: string;
} {
  const localDevelopment =
    baseUrl.protocol === "http:" &&
    (baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1");
  const tauriApplicationOrigin =
    (baseUrl.protocol === "http:" || baseUrl.protocol === "https:") &&
    baseUrl.hostname === "tauri.localhost";
  const localApplication =
    localDevelopment ||
    baseUrl.protocol === "tauri:" ||
    baseUrl.protocol === "asset:" ||
    tauriApplicationOrigin;
  if (!localApplication) {
    throw new Error("PDF assets must resolve from the local application origin.");
  }
  const root = new URL("/pdfjs-assets/", baseUrl);
  return {
    cMapUrl: new URL("cmaps/", root).href,
    standardFontDataUrl: new URL("standard_fonts/", root).href,
    wasmUrl: new URL("wasm/", root).href,
    iccUrl: new URL("iccs/", root).href,
  };
}

export function pdfFatalErrorMessage(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException") {
    return "This PDF is password-protected. Enter its password to continue.";
  }
  if (name === "UnsupportedPdfError") {
    return message;
  }
  if (
    name === "InvalidPDFException" ||
    /invalid pdf|pdf structure|xref|trailer|corrupt/i.test(message)
  ) {
    return "This PDF is corrupted or incomplete and cannot be opened.";
  }
  return `This PDF could not be opened. ${message}`;
}
