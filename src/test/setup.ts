import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
