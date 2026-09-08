import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  if (typeof document !== "undefined") {
    cleanup();
  }
});

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };

  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects = function getClientRects() {
    return [] as unknown as DOMRectList;
  };

  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return new DOMRect();
  };
}

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}

class WorkerStub extends EventTarget {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  postMessage() {}
  terminate() {}
}

if (typeof globalThis.Worker === "undefined") {
  vi.stubGlobal("Worker", WorkerStub);
}
