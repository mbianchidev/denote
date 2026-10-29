import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AUTHORING_COLORS, isPluginAuthoringResultFor, textStyleDelimiter, verifiedAuthoringEdit,
  type PluginAuthoringColor, type PluginAuthoringRequest, type PluginAuthoringResult, type PluginSourceEdit, type PluginTextStyle,
} from "@denote/plugin-sdk";
import type { PluginAuthoringContribution } from "../plugins/workerRuntime";
import { errorMessage } from "../lib/api";
import { markdownSourceSelection } from "../lib/emoji";
import { textStyleVariables, type AuthoringEditorBinding, type AuthoringSelection } from "../lib/authoring";
import type { NoteCommentsDocument, NoteCommentsSnapshot } from "../lib/noteComments";
import type { EditorDisplaySettings } from "../lib/editorDisplay";
import type { EditorSearchNavigation, FileLineEnding } from "../types";
import type { EnterNativeFullscreen } from "../lib/nativeFullscreen";
import { AuthoringDialog } from "./AuthoringDialog";
import { NoteCommentsPanel } from "./NoteCommentsPanel";
import { PresentationEditor } from "./PresentationEditor";
import { SpeechPanel } from "./SpeechPanel";
import "./AdvancedAuthoring.css";

export interface AdvancedAuthoringProps {
  speech?: {
    pluginId: string;
    workspaceScope: string;
    saveVoiceNote: (wav: Uint8Array, from: number, to: number) => Promise<void>;
    container: HTMLElement | null;
    open: boolean;
    suspended: boolean;
    onOpen: () => void;
    onClose: () => void;
  };
  path: string;
  source: string;
  readOnly: boolean;
  active: boolean;
  providers: PluginAuthoringContribution[];
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  nativeFullscreen?: EnterNativeFullscreen;
  registerCommentsAction?: (open: () => void) => () => void;
  registerSpeechAction?: (open: (dictation: boolean) => void) => () => void;
  request: (pluginId: string, providerId: string, request: PluginAuthoringRequest) => Promise<PluginAuthoringResult>;
  loadComments: (pluginId: string) => Promise<NoteCommentsSnapshot>;
  saveComments: (pluginId: string, hash: string, document: NoteCommentsDocument, source: string) => Promise<NoteCommentsSnapshot>;
  renderEditor: (binding: AuthoringEditorBinding, navigation: EditorSearchNavigation | undefined) => ReactNode;
  renderPreview: (source: string, slide: number, binding: AuthoringEditorBinding) => ReactNode;
  onChange: (source: string) => void;
}

export function AdvancedAuthoring(props: AdvancedAuthoringProps) {
  const { path, source, readOnly, active, providers, lineEnding, displaySettings, renderEditor, renderPreview, onChange } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const root = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<"styles" | "comments" | null>(null);
  const [speechSelection, setSpeechSelection] = useState<AuthoringSelection | null>(null);
  const [dictationRequest, setDictationRequest] = useState(0);
  const [presentation, setPresentation] = useState(false);
  const [selection, setSelection] = useState<AuthoringSelection | null>(null);
  const [styles, setStyles] = useState<{ source: string; spans: PluginTextStyle[] } | null>(null);
  const styleSnapshot = useRef(styles);
  styleSnapshot.current = styles;
  const captures = useRef(new Set<(allowCollapsed?: boolean) => AuthoringSelection | null>());
  const editHandlers = useRef(new Set<(edit: PluginSourceEdit, next: string) => boolean>());
  const sourceView = useRef<EditorView | null>(null);
  const [navigation, setNavigation] = useState<EditorSearchNavigation>();
  const navigationSequence = useRef(0);
  const [editorRevision, setEditorRevision] = useState(0);
  const [color, setColor] = useState<PluginAuthoringColor>("yellow");
  const [style, setStyle] = useState<"highlight" | "color">("highlight");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [initializingStyles, setInitializingStyles] = useState(() => providers.some((provider) => provider.feature === "text-styling"));
  const [styleNotice, setStyleNotice] = useState("");
  const alive = useRef(true);
  const styling = providers.find((provider) => provider.feature === "text-styling");
  const comments = providers.find((provider) => provider.feature === "note-comments");
  const slides = providers.find((provider) => provider.feature === "presentation");
  const stylingKey = styling ? `${styling.pluginId}:${styling.id}` : "";
  const binding = useMemo<AuthoringEditorBinding>(() => ({
    styles: () => styleSnapshot.current,
    sourcePreparation: { current: null },
    registerSelection: (capture) => {
      captures.current.add(capture);
      return () => { captures.current.delete(capture); };
    },
    registerEdit: (apply) => {
      editHandlers.current.add(apply);
      return () => { editHandlers.current.delete(apply); };
    },
  }), []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; captures.current.clear(); editHandlers.current.clear(); }; }, []);
  useEffect(() => {
    setStyles(null);
    styleSnapshot.current = null;
    setEditorRevision((value) => value + 1);
    setInitializingStyles(Boolean(stylingKey));
    if (!stylingKey && dialog === "styles") setDialog(null);
  }, [stylingKey]);
  useEffect(() => {
    if (!styling) return;
    let cancelled = false;
    const request: PluginAuthoringRequest = { feature: "text-styling", action: "parse", source };
    const initial = styleSnapshot.current === null;
    if (initial) setInitializingStyles(true);
    const timer = window.setTimeout(() => {
      void callbacks.current.request(styling.pluginId, styling.id, request).then((result) => {
        if (cancelled) return;
        if (!isPluginAuthoringResultFor(request, result) || result.feature !== "text-styling" || result.action !== "parse") {
          throw new Error("Invalid text styles. Source remains unchanged.");
        }
        setStyles({ source, spans: result.spans });
        setStyleNotice(result.notices.join(" "));
      }).catch((caught) => { if (!cancelled) setError(errorMessage(caught)); })
        .finally(() => { if (!cancelled) setInitializingStyles(false); });
    }, initial ? 0 : 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [source, stylingKey]);
  useEffect(() => { if (!comments && dialog === "comments") setDialog(null); }, [comments, dialog]);
  useEffect(() => { if (!slides) setPresentation(false); }, [slides]);
  const capture = (allowCollapsed = false): AuthoringSelection | null => {
    const view = sourceView.current;
    let visible = true;
    for (let element: HTMLElement | null = view?.dom ?? null; element && element !== root.current; element = element.parentElement) {
      if (element.hidden || element.style.display === "none") visible = false;
    }
    if (view?.dom.isConnected && visible && !view.composing) {
      const { doc, selection } = view.state;
      const displayed = doc.toString();
      const current = callbacks.current.source;
      const range = markdownSourceSelection(current, displayed, selection.main.from, selection.main.to);
      if (range && (range.from !== range.to || allowCollapsed)) return {
        source: current, ...range, restore: () => { if (view.dom.isConnected) view.focus(); },
        apply: (edit, next) => {
          if (!view.dom.isConnected || view.state.doc !== doc || view.state.readOnly ||
              edit.from !== range.from || edit.to !== range.to || callbacks.current.source !== current) return false;
          binding.sourcePreparation.current?.(next);
          view.dispatch({
            changes: { from: selection.main.from, to: selection.main.to, insert: edit.text },
            selection: { anchor: selection.main.from + edit.text.length },
            annotations: [Transaction.userEvent.of("input.text-style"), isolateHistory.of("full")],
          });
          view.focus();
          return true;
        },
      };
    }
    for (const capture of [...captures.current].reverse()) {
      const selected = capture(allowCollapsed);
      if (selected) return selected;
    }
    return null;
  };
  const open = (kind: "styles" | "comments" | "speech", dictation = false) => {
    if (kind === "speech") {
      setSpeechSelection(capture(true));
      if (dictation) setDictationRequest((current) => current + 1);
      callbacks.current.speech?.onOpen();
      return;
    }
    setSelection(capture());
    setError("");
    setDialog(kind);
  };
  const close = () => { setDialog(null); selection?.restore(); };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!comments) return;
    return callbacks.current.registerCommentsAction?.(() => openRef.current("comments"));
  }, [comments?.pluginId, comments?.id, path]);
  useEffect(() => {
    if (!props.speech) return;
    return callbacks.current.registerSpeechAction?.((dictation) => openRef.current("speech", dictation));
  }, [props.speech?.pluginId, props.speech?.workspaceScope, path]);
  useEffect(() => {
    if (!active || !props.speech?.open) setDictationRequest(0);
  }, [active, props.speech?.open]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!callbacks.current.active || event.isComposing || event.getModifierState("AltGraph") ||
          document.querySelector("dialog[open]:not(.presentation-stage-shell)") || presentation) return;
      const primary = /Mac|iPhone|iPad/i.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!primary) return;
      if (event.shiftKey && !event.altKey && (event.code === "KeyH" || event.key.toLowerCase() === "h") && styling && !callbacks.current.readOnly) {
        event.preventDefault(); openRef.current("styles");
      } else if (event.altKey && !event.shiftKey && (event.code === "KeyM" || event.key.toLowerCase() === "m") && comments) {
        event.preventDefault(); openRef.current("comments");
      } else if (event.altKey && !event.shiftKey && (event.code === "KeyP" || event.key.toLowerCase() === "p") && slides) {
        event.preventDefault(); setPresentation(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [stylingKey, comments, slides, presentation]);
  const run = (provider: PluginAuthoringContribution, request: PluginAuthoringRequest) =>
    callbacks.current.request(provider.pluginId, provider.id, request);
  const applySourceEdit = (edit: PluginSourceEdit, next: string) => {
    const view = sourceView.current;
    if (!view?.dom.isConnected || view.state.readOnly || view.composing) return false;
    for (let element: HTMLElement | null = view.dom; element && element !== root.current; element = element.parentElement) {
      if (element.hidden || element.style.display === "none") return false;
    }
    const displayed = view.state.doc.toString();
    const normalized = source.replace(/\r\n?/g, "\n");
    let from = source.slice(0, edit.from).replace(/\r\n?/g, "\n").length;
    let to = source.slice(0, edit.to).replace(/\r\n?/g, "\n").length;
    if (normalized !== displayed) {
      const selected = source.slice(edit.from, edit.to);
      const found = displayed.indexOf(selected);
      if (found < 0 || displayed.indexOf(selected, found + 1) >= 0) return false;
      const mapped = markdownSourceSelection(source, displayed, found, found + selected.length);
      if (mapped?.from !== edit.from || mapped.to !== edit.to) return false;
      from = found; to = found + selected.length;
    }
    binding.sourcePreparation.current?.(next);
    view.dispatch({
      changes: { from, to, insert: edit.text },
      selection: { anchor: from + edit.text.length },
      annotations: [Transaction.userEvent.of("input.text-style"), isolateHistory.of("full")],
    });
    view.focus();
    return true;
  };
  const navigate = (from: number, to: number) => {
    setDialog(null);
    setNavigation({ request: ++navigationSequence.current, from, to, text: source.slice(from, to) });
  };
  const format = async (range: { from: number; to: number }, clear = false) => {
    if (!styling || readOnly || busy) return;
    setBusy(true);
    setError("");
    const request: PluginAuthoringRequest = {
      feature: "text-styling", action: "format", source, from: range.from, to: range.to,
      style: clear ? "clear" : style, color,
    };
    try {
      const result = await run(styling, request);
      const next = verifiedAuthoringEdit(request, result);
      const parse: PluginAuthoringRequest = { feature: "text-styling", action: "parse", source: next };
      const rendered = await run(styling, parse);
      if (!isPluginAuthoringResultFor(parse, rendered) || rendered.feature !== "text-styling" || rendered.action !== "parse") {
        throw new Error("The formatted selection could not be rendered safely. Nothing was changed.");
      }
      if (!alive.current || callbacks.current.source !== source || callbacks.current.readOnly) {
        throw new Error("The note changed while formatting. Select the text again; nothing was changed.");
      }
      styleSnapshot.current = { source: next, spans: rendered.spans };
      setStyles(styleSnapshot.current);
      setDialog(null);
      const applied = "edit" in result && (selection?.apply?.(result.edit, next) ||
        applySourceEdit(result.edit, next) || [...editHandlers.current].some((apply) => apply(result.edit, next)));
      if (!applied) {
        onChange(next);
        setEditorRevision((value) => value + 1);
      }
    } catch (caught) { if (alive.current) setError(errorMessage(caught)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div ref={root} className="advanced-authoring" onFocusCapture={(event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".authoring-dialog, .sensitive-tool-panel")) return;
    const editor = target.closest<HTMLElement>(".cm-editor");
    if (editor) sourceView.current = EditorView.findFromDOM(editor);
    else if (target.closest('[contenteditable="true"]')) sourceView.current = null;
  }}>
    {presentation && slides ? <PresentationEditor path={path} source={source} readOnly={readOnly} active={active && !dialog}
      nativeFullscreen={props.nativeFullscreen}
      lineEnding={lineEnding} displaySettings={displaySettings} request={(request) => run(slides, request)}
      renderPreview={(source, index) => renderPreview(source, index, binding)} onChange={onChange}
      onClose={() => {
        setPresentation(false); setEditorRevision((value) => value + 1);
        window.requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-authoring-action="presentation"]')?.focus());
      }} /> : <>
      <div className="authoring-toolbar" aria-label="Advanced authoring">
        {styling ? <button type="button" className="secondary-button" disabled={readOnly || initializingStyles}
          data-authoring-action="text-styling"
          title="Text style (Command/Control-Shift-H)" onPointerDown={(event) => event.preventDefault()} onClick={() => open("styles")}>Text style</button> : null}
        {comments ? <button type="button" className="secondary-button" title="Comments (Command/Control-Alt-M)"
          data-authoring-action="note-comments"
          onPointerDown={(event) => event.preventDefault()} onClick={() => open("comments")}>Comments</button> : null}
        {slides ? <button type="button" className="secondary-button" title="Open as presentation (Command/Control-Alt-P)"
          data-authoring-action="presentation"
          onClick={() => setPresentation(true)}>Open as presentation</button> : null}
        {props.speech ? <button type="button" className="secondary-button" data-authoring-action="speech"
          onPointerDown={(event) => event.preventDefault()} onClick={() => open("speech")}>Speech</button> : null}
      </div>
      {error && !dialog ? <p role="alert" className="authoring-error">{error}</p> : null}
      {styleNotice ? <p role="status" className="authoring-muted">{styleNotice}</p> : null}
      {initializingStyles ? <p role="status">Loading text styles…</p> : <div key={editorRevision} className="advanced-authoring__editor">
        {renderEditor(binding, navigation)}
      </div>}
    </>}
    {active && props.speech?.open && props.speech.container ? createPortal(<SpeechPanel pluginId={props.speech.pluginId} workspaceScope={props.speech.workspaceScope}
      path={path} source={source} selection={speechSelection} captureSelection={() => capture(true)}
      dictationRequest={dictationRequest} suspended={props.speech.suspended || dialog !== null}
      readOnly={readOnly} onClose={() => {
        callbacks.current.speech?.onClose();
        speechSelection?.restore();
      }}
      onSaveVoiceNote={props.speech.saveVoiceNote}
      onInsert={(text, from, to) => {
        if (source !== callbacks.current.source || callbacks.current.readOnly ||
            !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length) {
          throw new Error("The note changed before insertion. Your reviewed transcript is still available.");
        }
        const edit = { from, to, text };
        const next = source.slice(0, edit.from) + text + source.slice(edit.to);
        binding.sourcePreparation.current?.(next);
        if (!applySourceEdit(edit, next) && ![...editHandlers.current].some((apply) => apply(edit, next))) {
          onChange(next); setEditorRevision((value) => value + 1);
        }
      }} />, props.speech.container) : null}
    {dialog === "comments" && comments ? <NoteCommentsPanel path={path} source={source} readOnly={readOnly}
      selection={selection} request={(request) => run(comments, request)}
      load={() => callbacks.current.loadComments(comments.pluginId)}
      save={(hash, document, captured) => callbacks.current.saveComments(comments.pluginId, hash, document, captured)}
      onClose={close} onNavigate={navigate} /> : null}
    {dialog === "styles" && styling ? <AuthoringDialog title="Text style" onClose={close}>
      {error ? <p role="alert" className="authoring-error">{error}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); if (selection) void format(selection); }}>
        <div className="authoring-actions">
          <label>Style <select value={style} onChange={(event) => setStyle(event.currentTarget.value === "color" ? "color" : "highlight")} autoFocus>
            <option value="highlight">Highlight</option><option value="color">Text color</option>
          </select></label>
          <label>Color <select value={color} onChange={(event) => {
            const selected = AUTHORING_COLORS.find((color) => color === event.currentTarget.value);
            if (selected) setColor(selected);
          }}>{AUTHORING_COLORS.map((color) => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}</select></label>
        </div>
        {selection && selection.source === source ? <>
          <p>Selected text</p>
          <p><span className="denote-text-style" data-style-kind={style} style={textStyleVariables(color)}>
            {source.slice(selection.from, selection.to)}
          </span></p>
          <details><summary>Source preview</summary><code>
            {textStyleDelimiter(style, color)}{source.slice(selection.from, selection.to)}{textStyleDelimiter(style, color)}
          </code></details>
        </> : <p>Select plain text in the note first. Use Source if its Rich selection is ambiguous.</p>}
        <button type="submit" className="primary-button" disabled={busy || readOnly || !selection || selection.source !== source}>
          {busy ? "Applying…" : "Apply style"}
        </button>
      </form>
      <h3>Styled excerpts</h3>
      <ol className="text-style-excerpts">
        {(styles?.source === source ? styles.spans.slice(0, 100) : []).map((span, index) => <li key={`${span.from}:${span.to}`}>
          <button type="button" className="secondary-button" aria-label={`Show styled excerpt ${index + 1}`}
            onClick={() => navigate(span.from, span.to)}>{span.text}</button>
          <span className="authoring-muted">{span.color} {span.style === "highlight" ? "highlight" : "text color"}</span>
          <button type="button" className="secondary-button" aria-label={`Clear text style ${index + 1}`}
            disabled={readOnly || busy} onClick={() => void format(span, true)}>Clear</button>
        </li>)}
      </ol>
      {!styles?.spans.length ? <p>No styled excerpts in this note.</p> : null}
      {(styles?.spans.length ?? 0) > 100 ? <p>Showing the first 100 excerpts. Source retains every style.</p> : null}
    </AuthoringDialog> : null}
  </div>;
}
