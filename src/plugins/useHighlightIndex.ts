import { useEffect, useMemo, useRef, useState } from "react";
import {
  isPluginAuthoringResultFor, textStyleDelimiter,
  type PluginAuthoringRequest, type PluginAuthoringResult, type PluginTextStyle,
} from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";
import type { DocumentBatch } from "../types";
import type { HighlightSearchMatches } from "../lib/search";
import type { PluginAuthoringContribution } from "./workerRuntime";
import { createTaskListSnapshot } from "./taskLists";

interface HighlightIndexState {
  key: string;
  matches: HighlightSearchMatches[];
  loading: boolean;
  notice: string;
  error: string;
}
const EMPTY: HighlightIndexState = { key: "", matches: [], loading: false, notice: "", error: "" };
const LOADING: HighlightIndexState = { ...EMPTY, loading: true };

export function useHighlightIndex(
  workspace: string | null,
  provider: PluginAuthoringContribution | null,
  request: (pluginId: string, providerId: string, request: PluginAuthoringRequest) => Promise<PluginAuthoringResult>,
  batch: DocumentBatch | null,
) {
  const key = workspace && provider ? `${workspace}\u0000${provider.pluginId}\u0000${provider.id}` : "";
  const snapshot = useMemo(() => key ? createTaskListSnapshot(key, batch, null) : null, [key, batch]);
  const cache = useRef(new Map<string, { source: string; spans: PluginTextStyle[] }>());
  const cacheKey = useRef("");
  const requester = useRef(request);
  requester.current = request;
  const [state, setState] = useState(EMPTY);
  useEffect(() => {
    if (cacheKey.current !== key) { cache.current.clear(); cacheKey.current = key; }
    if (!key || !provider || !snapshot || !batch) { setState(EMPTY); return; }
    let cancelled = false;
    const currentCache = cache.current;
    const paths = new Set(snapshot.documents.map((document) => document.path));
    for (const path of currentCache.keys()) if (!paths.has(path)) currentCache.delete(path);
    setState((current) => ({ ...current, key, loading: true, error: "" }));
    void (async () => {
      const matches: HighlightSearchMatches[] = [];
      const documents = new Map(batch.documents.map((document) => [document.path, document]));
      let total = 0;
      let bounded = false;
      for (const document of snapshot.documents) {
        if (cancelled) return;
        let parsed = currentCache.get(document.path);
        if (!parsed || parsed.source !== document.source) {
          const input: PluginAuthoringRequest = { feature: "text-styling", action: "parse", source: document.source };
          const result = await requester.current(provider.pluginId, provider.id, input);
          if (cancelled) return;
          if (!isPluginAuthoringResultFor(input, result) || result.feature !== "text-styling" || result.action !== "parse") {
            throw new Error("The highlight index returned invalid excerpts.");
          }
          parsed = { source: document.source, spans: result.spans.filter((span) => span.style === "highlight") };
          currentCache.set(document.path, parsed);
        }
        const available = parsed.spans.slice(0, Math.max(0, Math.min(128, 10_000 - total)));
        bounded ||= available.length < parsed.spans.length;
        total += available.length;
        if (available.length) matches.push({
          path: document.path, contentHash: documents.get(document.path)!.contentHash,
          matches: available.map((span) => {
            const delimiter = textStyleDelimiter(span.style, span.color);
            return { from: span.from + delimiter.length, to: span.to - delimiter.length };
          }),
        });
      }
      if (!cancelled) setState({
        key, matches, loading: false, error: "",
        notice: [
          snapshot.skippedCount || snapshot.truncated ? `Highlight search skipped ${snapshot.skippedCount} notes at its 5,000-note, 256 KiB-per-note, or 8 MiB input bounds.` : "",
          bounded ? "Highlight search shows at most 128 excerpts per note and 10,000 in total." : "",
        ].filter(Boolean).join(" "),
      });
    })().catch((caught) => {
      if (!cancelled) setState({ ...EMPTY, key, error: errorMessage(caught) });
    });
    return () => { cancelled = true; };
  }, [key, snapshot, batch]);
  return !key ? EMPTY : state.key === key ? state : LOADING;
}
