import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PluginAuthoringRequest, PluginAuthoringResult } from "@denote/plugin-sdk";
import type { SearchDocument } from "../types";
import { useHighlightIndex } from "./useHighlightIndex";

const provider = { pluginId: "denote.text-styling", id: "denote.text-styling.styles", title: "Styles", feature: "text-styling" as const };
const document: SearchDocument = {
  path: "Example.md", title: "Example", content: "=red=Example=red=", contentHash: "source-1",
  encoding: "utf8", lineEnding: "lf", tags: [], kind: "markdown", bookmarked: false, lastOpenedAt: null,
};
const parse = async (_plugin: string, _id: string, request: PluginAuthoringRequest): Promise<PluginAuthoringResult> => ({
  feature: "text-styling", action: "parse",
  spans: request.source.startsWith("=red=") ? [{
    from: 0, to: request.source.length, text: request.source.slice(5, -5), style: "highlight", color: "red",
  }] : [], notices: [],
});

describe("incremental highlight excerpts", () => {
  it("reuses unchanged sources and rejects outdated hash metadata", async () => {
    const request = vi.fn(parse);
    const initial = { documents: [document], skippedCount: 0, truncated: false };
    const view = renderHook(({ batch }) => useHighlightIndex("vault-alpha", provider, request, batch), { initialProps: { batch: initial } });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.matches).toEqual([{ path: "Example.md", contentHash: "source-1", matches: [{ from: 5, to: 12 }] }]);
    expect(request).toHaveBeenCalledTimes(1);
    view.rerender({ batch: { ...initial, documents: [{ ...document, bookmarked: true }] } });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    view.rerender({ batch: { ...initial, documents: [{ ...document, content: "Plain note", contentHash: "source-2" }] } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.matches).toEqual([]));
  });

  it("reports bounds and releases metadata when the provider is withdrawn", async () => {
    const request = vi.fn(parse);
    const batch = { documents: [document, { ...document, path: "Large.md", content: "x".repeat(256 * 1024 + 1) }],
      skippedCount: 0, truncated: false };
    const view = renderHook(({ enabled }) => useHighlightIndex("vault-alpha", enabled ? provider : null, request, batch),
      { initialProps: { enabled: true } });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    expect(view.result.current.notice).toMatch(/skipped 1/i);
    view.rerender({ enabled: false });
    expect(view.result.current.matches).toEqual([]);
  });
});
