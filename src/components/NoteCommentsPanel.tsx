import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PluginAuthoringRequest, PluginAuthoringResult, PluginCommentAnchor, PluginLocatedComment } from "@denote/plugin-sdk";
import { isPluginAuthoringResultFor } from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";
import type { AuthoringSelection } from "../lib/authoring";
import {
  isNoteCommentsSnapshot, type NoteComment, type NoteCommentsDocument, type NoteCommentsSnapshot,
} from "../lib/noteComments";
import { AuthoringDialog } from "./AuthoringDialog";

export interface NoteCommentsPanelProps {
  path: string;
  source: string;
  readOnly: boolean;
  selection: AuthoringSelection | null;
  request: (request: PluginAuthoringRequest) => Promise<PluginAuthoringResult>;
  load: () => Promise<NoteCommentsSnapshot>;
  save: (expectedHash: string, document: NoteCommentsDocument, source: string) => Promise<NoteCommentsSnapshot>;
  onClose: () => void;
  onNavigate: (from: number, to: number) => void;
}

export function NoteCommentsPanel(props: NoteCommentsPanelProps) {
  const { path, source, readOnly, selection, onClose, onNavigate } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const [snapshot, setSnapshot] = useState<NoteCommentsSnapshot | null>(null);
  const [locations, setLocations] = useState<PluginLocatedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [scope, setScope] = useState(selection && selection.from !== selection.to ? "selection" : "note");
  const [filter, setFilter] = useState("open");
  const [deleting, setDeleting] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const focusAfterSave = useRef<string | null | undefined>(undefined);
  const alive = useRef(true);
  const loadSequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await callbacks.current.load();
      if (!alive.current || sequence !== loadSequence.current) return;
      if (!isNoteCommentsSnapshot(next)) throw new Error("Invalid comments sidecar. Preserve it and restore a valid backup.");
      setSnapshot(next);
    } catch (caught) {
      if (alive.current && sequence === loadSequence.current) setError(errorMessage(caught));
    } finally {
      if (alive.current && sequence === loadSequence.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [path]);
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    setLocations([]);
    const request: PluginAuthoringRequest = {
      feature: "note-comments", action: "locate", source,
      anchors: (snapshot.document.notes[path] ?? []).map(({ id, anchor }) => ({ id, anchor })),
    };
    void callbacks.current.request(request).then((result) => {
      if (cancelled) return;
      if (!isPluginAuthoringResultFor(request, result) || result.feature !== "note-comments" || result.action !== "locate") {
        throw new Error("Comments returned invalid anchors. No text was selected or changed.");
      }
      setLocations(result.anchors);
    }).catch((caught) => { if (!cancelled) setError(errorMessage(caught)); });
    return () => { cancelled = true; };
  }, [path, source, snapshot]);
  useLayoutEffect(() => {
    if (focusAfterSave.current === undefined) return;
    const id = focusAfterSave.current;
    focusAfterSave.current = undefined;
    const button = id ? rows.current.get(id)?.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
    (button ?? input.current)?.focus();
  }, [snapshot]);

  const entries = snapshot ? Object.entries(snapshot.document.notes).flatMap(([notePath, comments]) =>
    comments.map((comment) => ({ notePath, comment, location: locations.find((item) => item.id === comment.id) }))) : [];
  const shown = entries.filter(({ notePath, comment, location }) => {
    if (filter === "other") return notePath !== path;
    if (notePath !== path) return false;
    if (filter === "orphaned") return comment.anchor !== null && location && location.status !== "attached";
    return filter === "resolved" ? comment.resolved : !comment.resolved;
  });
  const canSelect = selection !== null && selection.source === source && selection.from !== selection.to;
  const makeAnchor = async (): Promise<PluginCommentAnchor | null> => {
    if (scope === "selection" && !canSelect) throw new Error("The selected text changed. Close Comments and select it again, or choose Whole note.");
    const request: PluginAuthoringRequest = {
      feature: "note-comments", action: "anchor", source,
      from: scope === "selection" ? selection!.from : 0, to: scope === "selection" ? selection!.to : 0,
    };
    const result = await callbacks.current.request(request);
    if (!isPluginAuthoringResultFor(request, result) || result.feature !== "note-comments" || result.action !== "anchor") {
      throw new Error("The selected text could not be anchored safely. Nothing was saved.");
    }
    return result.anchor;
  };
  const persist = async (
    transform: (document: NoteCommentsDocument) => NoteCommentsDocument | Promise<NoteCommentsDocument>,
    message: string, focus: string | null = null,
  ): Promise<boolean> => {
    if (!snapshot || busy || callbacks.current.readOnly) return false;
    setBusy(true);
    setError("");
    const capturedSource = source;
    try {
      const nextDocument = await transform(snapshot.document);
      if (!alive.current || callbacks.current.source !== capturedSource || callbacks.current.readOnly) {
        throw new Error("The note changed while preparing the comment. Nothing was saved.");
      }
      const next = await callbacks.current.save(snapshot.contentHash, nextDocument, capturedSource);
      if (!alive.current) return false;
      if (!isNoteCommentsSnapshot(next)) throw new Error("The host returned invalid comments. Reload comments before continuing.");
      focusAfterSave.current = focus;
      setSnapshot(next);
      setStatus(message);
      setDeleting(null);
      return true;
    } catch (caught) {
      if (alive.current) setError(errorMessage(caught));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const replace = (document: NoteCommentsDocument, notePath: string, comments: NoteComment[]): NoteCommentsDocument => {
    const notes = { ...document.notes };
    if (comments.length) notes[notePath] = comments;
    else delete notes[notePath];
    return { ...document, notes };
  };
  const submit = async () => {
    if (!body.trim()) { input.current?.focus(); return; }
    if (new TextEncoder().encode(body).length > 4096) { setError("Comments must fit within 4 KiB."); return; }
    const saved = await persist(async (document) => {
      const now = Date.now();
      const existing = document.notes[path] ?? [];
      if (editing) {
        if (!existing.some((comment) => comment.id === editing)) throw new Error("This comment no longer exists. Cancel the edit or add a new comment.");
        return replace(document, path, existing.map((comment) =>
          comment.id === editing ? { ...comment, body: body.trim(), updatedAt: now } : comment));
      }
      const comment: NoteComment = {
        id: crypto.randomUUID(), body: body.trim(), anchor: await makeAnchor(),
        resolved: false, createdAt: now, updatedAt: now,
      };
      return replace(document, path, [...existing, comment]);
    }, editing ? "Comment saved." : "Comment added.");
    if (saved) { setBody(""); setEditing(null); }
  };
  const reattach = (notePath: string, comment: NoteComment) => persist(async (document) => {
    const anchor = await makeAnchor();
    const without = replace(document, notePath, document.notes[notePath].filter((item) => item.id !== comment.id));
    return replace(without, path, [...(without.notes[path] ?? []), { ...comment, anchor, updatedAt: Date.now() }]);
  }, "Comment reattached to this note.", comment.id);

  return <AuthoringDialog title="Comments" onClose={onClose}>
    <p className="authoring-muted">{path}. Comments stay in this vault, separate from Markdown.</p>
    {error ? <p role="alert" className="authoring-error">{error}</p> : null}
    <div className="authoring-actions">
      <label>Show comments <select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
        <option value="open">Open</option><option value="resolved">Resolved</option>
        <option value="orphaned">Orphaned</option><option value="other">Other notes</option>
      </select></label>
      <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void load()}>Reload comments</button>
    </div>
    <p role="status">{loading ? "Loading comments…" : status || `${shown.length} comments shown.`}</p>
    {snapshot ? <>
      <ol className="note-comments">
        {shown.map(({ notePath, comment, location }) => <li key={comment.id}
          ref={(element) => { if (element) rows.current.set(comment.id, element); else rows.current.delete(comment.id); }}>
          <p className="authoring-muted">
            {notePath !== path ? notePath : comment.anchor === null ? "Whole note" :
              location?.status === "attached" ? `Line ${source.slice(0, location.from!).split(/\r\n|\r|\n/).length}` :
                location?.status === "ambiguous" ? "Orphaned: ambiguous text" :
                  location?.status === "missing" ? "Orphaned: text missing" : "Checking anchor…"}
            {comment.resolved ? " · Resolved" : ""}
          </p>
          {comment.anchor ? <blockquote>{comment.anchor.quote}</blockquote> : null}
          <p className="note-comments__body">{comment.body}</p>
          <div className="authoring-actions">
            {notePath === path && comment.anchor && location?.status === "attached" ? <button type="button" className="secondary-button"
              onClick={() => onNavigate(location.from!, location.to!)}>Show text</button> : null}
            {notePath === path ? <>
              <button type="button" className="secondary-button" aria-label="Edit comment" disabled={readOnly || busy}
                onClick={() => { setEditing(comment.id); setBody(comment.body); input.current?.focus(); }}>Edit</button>
              <button type="button" className="secondary-button" aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"}
                disabled={readOnly || busy} onClick={() => void persist((document) =>
                  replace(document, path, document.notes[path].map((item) => item.id === comment.id
                    ? { ...item, resolved: !item.resolved, updatedAt: Date.now() } : item)),
                  comment.resolved ? "Comment reopened." : "Comment resolved.")}>{comment.resolved ? "Reopen" : "Resolve"}</button>
            </> : null}
            {notePath !== path || comment.anchor !== null && location?.status !== "attached" ?
              <button type="button" className="secondary-button" disabled={readOnly || busy}
                onClick={() => void reattach(notePath, comment)}>{scope === "selection" && canSelect ? "Attach to selected text" : "Attach to whole note"}</button> : null}
            <button type="button" className="secondary-button" aria-label="Delete comment" disabled={readOnly || busy}
              onClick={() => setDeleting(comment.id)}>Delete</button>
          </div>
          {deleting === comment.id ? <div role="group" aria-label="Delete this comment?" className="authoring-actions">
            <span>Delete this comment?</span>
            <button type="button" className="secondary-button" onClick={() => setDeleting(null)} autoFocus>Cancel</button>
            <button type="button" className="danger-button" disabled={busy || readOnly} onClick={() => void persist((document) =>
              replace(document, notePath, document.notes[notePath].filter((item) => item.id !== comment.id)), "Comment deleted.")}>Delete</button>
          </div> : null}
        </li>)}
      </ol>
      {!shown.length ? <p className="authoring-muted">{filter === "other" ? "No comments belong to other notes." : "No comments in this view."}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>Comment<textarea ref={input} value={body} onChange={(event) => setBody(event.currentTarget.value)}
          disabled={readOnly || busy} rows={4} autoFocus /></label>
        {!editing ? <label>Attach to <select value={scope} disabled={readOnly || busy} onChange={(event) => setScope(event.currentTarget.value)}>
          <option value="note">Whole note</option><option value="selection" disabled={!canSelect}>Selected text</option>
        </select></label> : null}
        {scope === "selection" && canSelect && !editing ? <blockquote>{source.slice(selection.from, selection.to)}</blockquote> : null}
        <div className="authoring-actions">
          {editing ? <button type="button" className="secondary-button" disabled={busy}
            onClick={() => { setEditing(null); setBody(""); input.current?.focus(); }}>Cancel edit</button> : null}
          <button type="submit" className="primary-button" disabled={readOnly || busy || !body.trim()}>
            {busy ? "Saving…" : editing ? "Save comment" : "Add comment"}
          </button>
        </div>
      </form>
    </> : null}
  </AuthoringDialog>;
}
