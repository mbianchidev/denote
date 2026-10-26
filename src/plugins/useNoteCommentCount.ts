import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import { isNoteCommentsSnapshot, type NoteCommentsSnapshot } from "../lib/noteComments";
import type { PluginAuthoringContribution } from "./workerRuntime";

interface CountState {
  key: string;
  count: number | null;
  error: string;
}
const EMPTY: CountState = { key: "", count: null, error: "" };

export function useNoteCommentCount(
  vault: string | null,
  provider: PluginAuthoringContribution | null,
  path: string | null,
  read: (pluginId: string, vault: string) => Promise<NoteCommentsSnapshot>,
) {
  const key = vault && provider && path ? `${vault}\u0000${provider.pluginId}\u0000${provider.id}\u0000${path}` : "";
  const context = useRef({ key, vault, pluginId: provider?.pluginId, path });
  context.current = { key, vault, pluginId: provider?.pluginId, path };
  const reader = useRef(read);
  reader.current = read;
  const revision = useRef(0);
  const [state, setState] = useState(EMPTY);
  const update = useCallback((vault: string, pluginId: string, snapshot: NoteCommentsSnapshot) => {
    const current = context.current;
    if (!current.key || current.vault !== vault || current.pluginId !== pluginId || !current.path) return;
    const count = openCount(snapshot, current.path);
    revision.current++;
    setState({ key: current.key, count, error: "" });
  }, []);

  useEffect(() => {
    const requested = ++revision.current;
    if (!key || !vault || !provider || !path) { setState(EMPTY); return; }
    let cancelled = false;
    void reader.current(provider.pluginId, vault).then((snapshot) => {
      if (cancelled || revision.current !== requested || context.current.key !== key) return;
      setState({ key, count: openCount(snapshot, path), error: "" });
    }).catch((caught) => {
      if (!cancelled && revision.current === requested && context.current.key === key) {
        setState({ key, count: null, error: errorMessage(caught) });
      }
    });
    return () => { cancelled = true; };
  }, [key]);

  return {
    count: key && state.key === key ? state.count : null,
    error: key && state.key === key ? state.error : "",
    update,
  };
}

function openCount(snapshot: NoteCommentsSnapshot, path: string): number {
  if (!isNoteCommentsSnapshot(snapshot)) throw new Error("Invalid comments sidecar. Preserve it and restore a valid backup.");
  return snapshot.document.notes[path]?.filter((comment) => !comment.resolved).length ?? 0;
}
