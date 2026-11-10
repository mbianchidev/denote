import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  getRemoteImagesAllowed, isRemoteImageSource, REMOTE_IMAGE_PERMISSION_KEY, useRemoteImagePreference,
} from "./remoteImages";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("defaults closed, recognizes remote sources and rejects corrupted consent", () => {
  expect(getRemoteImagesAllowed()).toBe(false);
  expect(isRemoteImageSource("HTTPS://images.example.test/example.svg")).toBe(true);
  expect(isRemoteImageSource("//images.example.test/example.svg")).toBe(true);
  expect(isRemoteImageSource("assets/example.svg")).toBe(false);
  expect(isRemoteImageSource("data:image/svg+xml,synthetic")).toBe(false);
  localStorage.setItem(REMOTE_IMAGE_PERMISSION_KEY, "invalid");
  expect(() => getRemoteImagesAllowed()).toThrow(/invalid.*blocked/);
});

it("keeps revocation effective and reports failure when consent cannot be persisted", async () => {
  localStorage.setItem(REMOTE_IMAGE_PERMISSION_KEY, "true");
  const reportError = vi.fn();
  const { result } = renderHook(() => useRemoteImagePreference(reportError));
  await waitFor(() => expect(result.current.allowed).toBe(true));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Synthetic unavailable storage", "SecurityError");
  });

  act(() => result.current.update(false));

  expect(result.current.allowed).toBe(false);
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining("blocked for this session"),
  }));
  act(() => result.current.update(true));
  expect(result.current.allowed).toBe(false);
});
