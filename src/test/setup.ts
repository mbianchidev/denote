import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};

HTMLDialogElement.prototype.close = function close() {
  this.open = false;
};

Range.prototype.getClientRects = function getClientRects() {
  return [] as unknown as DOMRectList;
};

Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return new DOMRect();
};

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

class WorkerStub extends EventTarget {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  postMessage() {}
  terminate() {}
}

vi.stubGlobal("Worker", WorkerStub);
