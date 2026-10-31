import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  isPluginAuthoringResultFor, verifiedAuthoringEdit,
  type PluginAuthoringRequest, type PluginAuthoringResult, type PluginPresentationModel,
} from "@denote/plugin-sdk";
import { errorMessage } from "../lib/api";
import type { EditorDisplaySettings } from "../lib/editorDisplay";
import type { SourceEditorNavigation } from "../lib/sourceOutline";
import type { FileLineEnding } from "../types";
import { PresentationPlayback } from "../lib/presentationPlayback";
import type { EnterNativeFullscreen } from "../lib/nativeFullscreen";
import { PlainTextEditor } from "./PlainTextEditor";

export interface PresentationEditorProps {
  path: string;
  source: string;
  readOnly: boolean;
  active: boolean;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  nativeFullscreen?: EnterNativeFullscreen;
  request: (request: PluginAuthoringRequest) => Promise<PluginAuthoringResult>;
  renderPreview: (source: string, slide: number) => ReactNode;
  onChange: (source: string) => void;
  onClose: () => void;
}

export function PresentationEditor(props: PresentationEditorProps) {
  const { path, source, readOnly, active, lineEnding, displaySettings, renderPreview, onChange, onClose } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const [parsed, setParsed] = useState<{ source: string; model: PluginPresentationModel; revision: number } | null>(null);
  const model = parsed?.source === source ? parsed.model : null;
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(false);
  const overviewList = useRef<HTMLOListElement>(null);
  const reorderFocus = useRef<{ index: number; direction: "earlier" | "later" } | null>(null);
  const [reorderStatus, setReorderStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(10);
  const [intervalInput, setIntervalInput] = useState("10");
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [nativeMode, setNativeMode] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const fullscreenBusyRef = useRef(false);
  const nativeRelease = useRef<(() => Promise<void>) | null>(null);
  const enterController = useRef<AbortController | null>(null);
  const stageDialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLElement>(null);
  const presentButton = useRef<HTMLButtonElement>(null);
  const [navigation, setNavigation] = useState<SourceEditorNavigation>();
  const navigationSequence = useRef(0);
  const parseSequence = useRef(0);
  const defaultsKey = useRef("");
  const cursorLine = useRef<number | null>(null);
  const pendingSlide = useRef<number | null>(null);
  const intervalValid = intervalInput !== "" && Number.isFinite(Number(intervalInput)) && Number(intervalInput) >= 1 && Number(intervalInput) <= 3600;
  const intervalValidRef = useRef(intervalValid);
  intervalValidRef.current = intervalValid;
  const alive = useRef(true);
  const playback = useRef(new PresentationPlayback(1, 10, false));
  const [state, setState] = useState(() => playback.current.tick(performance.now()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentModel = useRef(model);
  currentModel.current = model;
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const publish = useCallback(() => {
    const next = playback.current.tick(performance.now());
    stateRef.current = next;
    setState((current) => current.index === next.index && current.playing === next.playing &&
      Math.ceil(current.remainingMs / 1000) === Math.ceil(next.remainingMs / 1000) ? current : next);
  }, []);
  const pause = useCallback(() => { playback.current.pause(); publish(); }, [publish]);
  const exitFullscreen = useCallback(async () => {
    pause();
    if (fullscreenBusyRef.current) return;
    fullscreenBusyRef.current = true;
    setFullscreenBusy(true);
    try {
      const release = nativeRelease.current;
      if (release) {
        await release();
        if (nativeRelease.current === release) nativeRelease.current = null;
        if (alive.current) {
          fullscreenRef.current = false;
          setNativeMode(false);
          setFullscreen(false);
        }
      } else if (document.fullscreenElement) await document.exitFullscreen();
    } catch (caught) {
      if (alive.current) setError(errorMessage(caught));
      else console.error("Unable to restore closed presentation:", caught);
    } finally {
      fullscreenBusyRef.current = false;
      if (alive.current) setFullscreenBusy(false);
    }
  }, [pause]);
  useLayoutEffect(() => {
    const dialog = stageDialog.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (nativeMode) { dialog.showModal(); stage.current?.focus(); }
    else { dialog.open = true; if (callbacks.current.active) presentButton.current?.focus(); }
  }, [nativeMode]);
  useEffect(() => {
    let cancelled = false;
    const revision = ++parseSequence.current;
    pause();
    setError("");
    const request: PluginAuthoringRequest = { feature: "presentation", action: "parse", source };
    void callbacks.current.request(request).then((result) => {
      if (cancelled || revision !== parseSequence.current) return;
      if (!isPluginAuthoringResultFor(request, result) || result.feature !== "presentation" || result.action !== "parse") {
        throw new Error("The presentation returned an invalid preview. Source remains available.");
      }
      setParsed({ source, model: result.model, revision });
      const key = `${result.model.options.advanceSeconds}:${result.model.options.loop}`;
      if (defaultsKey.current !== key) {
        defaultsKey.current = key;
        setSeconds(result.model.options.advanceSeconds);
        setIntervalInput(String(result.model.options.advanceSeconds));
        setLoop(result.model.options.loop);
      }
    }).catch((caught) => { if (!cancelled) setError(errorMessage(caught)); });
    return () => { cancelled = true; };
  }, [source, pause]);
  useEffect(() => {
    const index = stateRef.current.index;
    playback.current.pause();
    playback.current = new PresentationPlayback(model?.slides.length ?? 1, seconds, loop);
    playback.current.move(index, performance.now());
    publish();
  }, [model?.slides.length, seconds, loop, publish]);
  useEffect(() => {
    if (!active) {
      pause();
      enterController.current?.abort();
      if (fullscreenRef.current) void exitFullscreen();
    }
  }, [active, pause, exitFullscreen]);
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => {
      if (document.hidden || !callbacks.current.active) pause();
      else publish();
    }, 100);
    return () => window.clearInterval(timer);
  }, [state.playing, publish, pause]);
  const navigate = useCallback((index: number, revealSource = true) => {
    playback.current.move(index, performance.now());
    publish();
    const target = currentModel.current?.slides[stateRef.current.index];
    if (target && revealSource && !fullscreenRef.current) {
      setNavigation({ request: ++navigationSequence.current, line: target.line, column: 1 });
    }
  }, [publish]);
  const togglePlay = useCallback(() => {
    if (stateRef.current.playing) pause();
    else if (callbacks.current.active && currentModel.current && intervalValidRef.current && !document.hidden) {
      playback.current.play(performance.now());
      publish();
    }
  }, [pause, publish]);
  useEffect(() => {
    if (!model || fullscreenRef.current) return;
    if (pendingSlide.current !== null) {
      const target = pendingSlide.current;
      pendingSlide.current = null;
      navigate(target);
      return;
    }
    if (cursorLine.current === null) return;
    let index = 0;
    for (let at = 0; at < model.slides.length; at++) if (model.slides[at].line <= cursorLine.current) index = at;
    navigate(index, false);
  }, [model, navigate]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause(); };
    const blur = () => pause();
    const changed = () => {
      if (nativeRelease.current) return;
      const isFullscreen = document.fullscreenElement === stage.current;
      fullscreenRef.current = isFullscreen;
      setFullscreen(isFullscreen);
      if (!isFullscreen) {
        pause();
        presentButton.current?.focus();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (!fullscreenRef.current || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        void exitFullscreen();
      } else if (event.key.toLowerCase() === "p") pause();
      else if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      else if (["ArrowRight", "PageDown"].includes(event.key)) navigate(stateRef.current.index + 1, false);
      else if (["ArrowLeft", "PageUp"].includes(event.key)) navigate(stateRef.current.index - 1, false);
      else if (event.key === "Home") navigate(0, false);
      else if (event.key === "End") navigate((currentModel.current?.slides.length ?? 1) - 1, false);
      else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) togglePlay();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
    };
  }, [navigate, pause, togglePlay, exitFullscreen]);
  useEffect(() => {
    alive.current = true;
    const element = stage.current;
    const dialog = stageDialog.current;
    return () => {
      alive.current = false;
      enterController.current?.abort();
      playback.current.pause();
      dialog?.close();
      const release = nativeRelease.current;
      nativeRelease.current = null;
      if (release) void release().catch((caught) => console.error("Unable to restore closed presentation:", caught));
      if (document.fullscreenElement === element) {
        void document.exitFullscreen().catch((caught) => console.error("Unable to exit closed presentation:", caught));
      }
    };
  }, []);
  const present = async () => {
    const element = stage.current;
    if (!element || !model || fullscreenBusyRef.current) return;
    fullscreenBusyRef.current = true;
    setFullscreenBusy(true);
    const controller = new AbortController();
    enterController.current = controller;
    try {
      if (document.fullscreenEnabled === false || typeof element.requestFullscreen !== "function") {
        const enter = callbacks.current.nativeFullscreen;
        if (!enter) throw new Error("Full-screen presentation is unavailable in this window.");
        const release = await enter(controller.signal);
        if (!alive.current || controller.signal.aborted) { await release(); return; }
        nativeRelease.current = release;
        fullscreenRef.current = true;
        setNativeMode(true);
        setFullscreen(true);
      } else {
        await element.requestFullscreen();
        if (!alive.current || controller.signal.aborted) {
          if (document.fullscreenElement === element) await document.exitFullscreen();
          return;
        }
        element.focus();
      }
      if (model.options.autoplay && callbacks.current.active && intervalValidRef.current && !document.hidden) {
        playback.current.play(performance.now());
        publish();
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      if (alive.current) setError(errorMessage(caught));
      else console.error("Unable to complete closed presentation:", caught);
    } finally {
      if (enterController.current === controller) enterController.current = null;
      fullscreenBusyRef.current = false;
      if (alive.current) setFullscreenBusy(false);
    }
  };
  const reorder = async (from: number, to: number) => {
    if (!model || readOnly || busy) return;
    pause();
    setBusy(true);
    setError("");
    reorderFocus.current = { index: from, direction: to < from ? "earlier" : "later" };
    const order = model.slides.map((_, index) => index);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    const request: PluginAuthoringRequest = { feature: "presentation", action: "reorder", source, order };
    try {
      const result = await callbacks.current.request(request);
      const next = verifiedAuthoringEdit(request, result);
      if (!alive.current || callbacks.current.source !== source || callbacks.current.readOnly) {
        throw new Error("The deck changed while reordering. No slides were moved.");
      }
      pendingSlide.current = to;
      reorderFocus.current.index = to;
      setReorderStatus(`Moved slide to position ${to + 1}.`);
      onChange(next);
      navigate(to, false);
    } catch (caught) { if (alive.current) setError(errorMessage(caught)); }
    finally { if (alive.current) setBusy(false); }
  };
  useLayoutEffect(() => {
    if (!reorderFocus.current || busy || !model) return;
    const { index, direction } = reorderFocus.current;
    reorderFocus.current = null;
    const row = overviewList.current?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`);
    const move = row?.querySelector<HTMLButtonElement>(`[data-reorder="${direction}"]`);
    (move && !move.disabled ? move : row?.querySelector<HTMLButtonElement>("[data-slide-select]"))?.focus();
  }, [model, busy]);
  const slide = model?.slides[Math.min(state.index, model.slides.length - 1)];
  const preview = slide ? source.slice(slide.from, slide.to) : "";
  return <div className="presentation-editor">
    <div className="authoring-toolbar">
      <button type="button" className="secondary-button" onClick={() => { pause(); onClose(); }}>Return to note</button>
      <button type="button" className="secondary-button" aria-pressed={overview} onClick={() => setOverview((value) => !value)}>Overview</button>
      <span className="authoring-muted">{model?.options.title || path}</span>
    </div>
    {error && !fullscreen ? <p role="alert" className="authoring-error">{error}</p> : null}
    {model?.notices.length ? <div className="presentation-notices" role="status">
      {model.notices.map((notice, index) => <p key={index}>{notice}</p>)}
    </div> : null}
    {reorderStatus ? <p role="status" className="authoring-muted">{reorderStatus}</p> : null}
    {overview && model ? <ol ref={overviewList} className="presentation-overview" aria-label="Slide overview">
      {model.slides.map((slide, index) => <li key={index} data-slide-index={index}>
        <button type="button" className="secondary-button" aria-pressed={state.index === index}
          data-slide-select
          onClick={() => navigate(index)}>Slide {index + 1}: {slide.title}</button>
        <div className="authoring-actions">
          <button type="button" className="secondary-button" aria-label={`Move slide ${index + 1} earlier`}
            data-reorder="earlier"
            disabled={readOnly || busy || index === 0} onClick={() => void reorder(index, index - 1)}>Earlier</button>
          <button type="button" className="secondary-button" aria-label={`Move slide ${index + 1} later`}
            data-reorder="later"
            disabled={readOnly || busy || index === model.slides.length - 1} onClick={() => void reorder(index, index + 1)}>Later</button>
        </div>
      </li>)}
    </ol> : null}
    <div className="presentation-authoring">
      <section className="presentation-source" aria-label="Markdown deck source">
        <PlainTextEditor value={source} ariaLabel="Presentation source" readOnly={readOnly} spellCheck
          binary={false} filePath={path} lineEnding={lineEnding} displaySettings={displaySettings}
          markdownSource onChange={onChange} sourceNavigation={navigation}
          onError={(caught) => setError(errorMessage(caught))}
          onCursorChange={(position) => {
            cursorLine.current = position.line + 1;
            const slides = currentModel.current?.slides;
            if (!slides || fullscreenRef.current) return;
            let index = 0;
            for (let at = 0; at < slides.length; at++) if (slides[at].line <= position.line + 1) index = at;
            if (index !== stateRef.current.index) navigate(index, false);
          }} />
      </section>
      <dialog ref={stageDialog} className={`presentation-stage-shell${nativeMode ? " presentation-stage-shell--fullscreen" : ""}`}
        role={nativeMode ? "dialog" : "region"} aria-modal={nativeMode ? true : undefined}
        aria-label={nativeMode ? "Full-screen presentation" : "Slide preview"}
        onCancel={(event) => { event.preventDefault(); if (nativeRelease.current) void exitFullscreen(); }}>
      <section ref={stage} tabIndex={-1} className="presentation-stage" aria-label="Presentation"
        data-slide-theme={model?.options.theme ?? "system"}>
        {error && fullscreen ? <p role="alert" className="authoring-error">{error}</p> : null}
        <div className="presentation-slide-frame" style={{
          "--slide-ratio": model?.options.aspectRatio.replace(":", " / ") ?? "16 / 9",
          "--slide-ratio-number": model?.options.aspectRatio === "4:3" ? 4 / 3 : model?.options.aspectRatio === "16:10" ? 1.6 : 16 / 9,
          "--slide-alignment": model?.options.alignment ?? "left",
        } as CSSProperties}>
          <div key={`${parsed?.revision}:${state.index}`} className={`presentation-slide${model?.options.transition === "fade" ? " presentation-slide--fade" : ""}`}>
            {slide ? preview.trim() ? renderPreview(preview, state.index) : <p>This slide is empty. Add content in Source.</p> : <p role="status">{error ? "Preview is unavailable. Correct Source and try again." : "Loading presentation…"}</p>}
          </div>
          {model?.options.slideNumbers ? <span className="presentation-slide-number" aria-hidden="true">{state.index + 1}</span> : null}
        </div>
        {fullscreen && model?.options.author ? <p className="authoring-muted">{model.options.author}</p> : null}
        <div className="presentation-controls" aria-label="Presentation controls">
          <div className="authoring-actions">
            <button type="button" className="secondary-button" aria-label="First slide" disabled={!model || state.index === 0} onClick={() => navigate(0)}>First</button>
            <button type="button" className="secondary-button" aria-label="Previous slide" disabled={!model || state.index === 0} onClick={() => navigate(state.index - 1)}>Previous</button>
            <span role="status">{model ? `Slide ${state.index + 1} of ${model.slides.length}` : "Parsing deck…"}</span>
            <button type="button" className="secondary-button" aria-label="Next slide" disabled={!model || state.index >= model.slides.length - 1} onClick={() => navigate(state.index + 1)}>Next</button>
            <button type="button" className="secondary-button" aria-label="Last slide" disabled={!model || state.index >= model.slides.length - 1} onClick={() => navigate((model?.slides.length ?? 1) - 1)}>Last</button>
          </div>
          <div className="authoring-actions">
            <button type="button" className="secondary-button" disabled={!active || !model || !intervalValid} onClick={togglePlay}>{state.playing ? "Pause" : "Play"}</button>
            <button type="button" className="secondary-button" disabled={!model} onClick={() => { playback.current.restart(performance.now()); publish(); }}>Restart</button>
            <button type="button" className="secondary-button" disabled={!model} onClick={() => { pause(); navigate(0); }}>Stop</button>
            <label className="presentation-control"><span>Advance seconds</span><input type="number" min={1} max={3600} step="any" value={intervalInput} aria-invalid={!intervalValid}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setIntervalInput(value);
                const seconds = Number(value);
                if (!value || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
                  pause(); setError("Choose an advance interval from 1 to 3600 seconds.");
                } else { setError(""); setSeconds(seconds); }
              }} /></label>
            <label className="presentation-control"><input type="checkbox" checked={loop}
              onChange={(event) => setLoop(event.currentTarget.checked)} /><span>Loop</span></label>
            <span role="timer" aria-live="off">{state.playing ? `Next slide in ${Math.ceil(state.remainingMs / 1000)} s` : "Paused"}</span>
          </div>
          {fullscreen ? <button type="button" className="secondary-button" disabled={fullscreenBusy}
            onClick={() => void exitFullscreen()}>Exit presentation</button> : <button ref={presentButton} type="button" className="primary-button"
            disabled={!model || !active || fullscreenBusy} onClick={() => void present()}>Present</button>}
          <small className="authoring-muted">Full screen: arrows, Page Up/Down, Home/End; Space on the slide plays or pauses, P pauses, Escape exits.</small>
        </div>
      </section>
      </dialog>
    </div>
  </div>;
}
