import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { AuthoringSelection } from "../lib/authoring";
import { SpeechCapture } from "../lib/speechCapture";
import {
  decodeSpeechFile, speechBase64, speechChunks, speechInsertionTarget, speechText, timestampedTranscript,
  type SpeechEngineStatus, type SpeechProgress, type SpeechTranscript,
} from "../lib/speech";
import { SensitiveToolPanel } from "./SensitiveToolPanel";
import { AudioPlayback } from "./AudioPlayback";
import "./SensitiveTools.css";

export function SpeechPanel({ pluginId, workspaceScope, path, source, selection, captureSelection, readOnly, suspended = false, dictationRequest = 0, shortcutLabel = "Ctrl+Space", onShortcutChange, onInsert, onSaveVoiceNote, onClose }: {
  pluginId: string; workspaceScope: string; path: string; source: string;
  selection: AuthoringSelection | null; readOnly: boolean;
  captureSelection?: () => AuthoringSelection | null;
  suspended?: boolean;
  dictationRequest?: number;
  shortcutLabel?: string;
  onShortcutChange?: (value: string) => string;
  onInsert: (text: string, from: number, to: number) => void;
  onSaveVoiceNote: (wav: Uint8Array, from: number, to: number) => Promise<void>;
  onClose: () => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState<"playing" | "paused" | null>(null);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const [captureState, setCaptureState] = useState<"requesting" | "recording" | "paused" | "finishing" | null>(null);
  const captureStateRef = useRef(captureState);
  captureStateRef.current = captureState;
  const [mode, setMode] = useState<"note" | "dictation">("note");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [recorded, setRecorded] = useState(false);
  const [engine, setEngine] = useState<SpeechEngineStatus | null>(null);
  const [locale, setLocale] = useState("auto");
  const [approved, setApproved] = useState(false);
  const [removeApproved, setRemoveApproved] = useState(false);
  const [keepRecoveryApproved, setKeepRecoveryApproved] = useState(false);
  const [progress, setProgress] = useState<SpeechProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [shortcutDraft, setShortcutDraft] = useState(shortcutLabel);
  useEffect(() => setShortcutDraft(shortcutLabel), [shortcutLabel]);
  const [transcript, setTranscript] = useState<SpeechTranscript | null>(null);
  const [draft, setDraft] = useState("");
  const [timestamps, setTimestamps] = useState(false);
  const [capturedSelection, setCapturedSelection] = useState(selection);
  const [draftEdited, setDraftEdited] = useState(false);
  const wav = useRef<Uint8Array | null>(null);
  const capture = useRef<SpeechCapture | null>(null);
  const finishingCapture = useRef<SpeechCapture | null>(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const ttsEpoch = useRef(0);
  const operation = useRef<string | null>(null);
  const handledDictationRequest = useRef(0);
  const queuedDictationRequest = useRef<number | null>(null);
  const currentDictationRequest = useRef(dictationRequest);
  currentDictationRequest.current = dictationRequest;
  const lifecycleScope = useRef({ pluginId, workspaceScope, path });
  const importController = useRef<AbortController | null>(null);
  const finishRef = useRef<(transcribe?: boolean) => Promise<void>>(async () => {});
  const transcriptInput = useRef<HTMLTextAreaElement>(null);
  const stopRecordingButton = useRef<HTMLButtonElement>(null);
  const cancelRecordingButton = useRef<HTMLButtonElement>(null);
  const saveRecordingButton = useRef<HTMLButtonElement>(null);
  const transcribeButton = useRef<HTMLButtonElement>(null);
  const modelSummary = useRef<HTMLElement>(null);
  const insertion = useMemo(() => speechInsertionTarget(source, capturedSelection), [source, capturedSelection]);
  const configureShortcut = (value: string) => {
    setError(""); setStatus("");
    try {
      if (busy || capture.current || finishingCapture.current) throw new Error("Finish or cancel recording before changing its shortcut.");
      if (!onShortcutChange) throw new Error("Shortcut configuration is unavailable. Reopen Speech.");
      setShortcutDraft(onShortcutChange(value));
      setStatus("Dictation shortcut updated.");
    } catch (caught) { setError(errorMessage(caught)); }
  };

  const stopSpeech = () => { ++ttsEpoch.current; speakingRef.current = null; window.speechSynthesis?.cancel(); if (alive.current) setSpeaking(null); };
  const clearAudio = () => {
    wav.current?.fill(0); wav.current = null;
    if (alive.current) setRecorded(false);
    window.dispatchEvent(new Event("denote:speech-stop"));
  };
  const cancelOperation = async () => {
    const id = operation.current;
    operation.current = null;
    if (id) await api.cancelSpeechOperation(pluginId, id);
  };
  const clearSensitive = async (reason = "Speech stopped. Unsaved audio and transcript drafts were discarded.", consumeRequest = true) => {
    ++epoch.current;
    if (consumeRequest) handledDictationRequest.current = currentDictationRequest.current;
    queuedDictationRequest.current = null;
    importController.current?.abort(); importController.current = null;
    stopSpeech();
    const active = capture.current ?? finishingCapture.current;
    capture.current = null; finishingCapture.current = null;
    clearAudio();
    if (alive.current) {
      setCaptureState(null); setTranscript(null); setDraft(""); setDraftEdited(false); setTimestamps(false); setLevel(0); setBusy(false); setProgress(null);
      setStatus(reason);
    }
    if (transcriptInput.current) transcriptInput.current.value = "";
    await Promise.all([active?.cancel(), cancelOperation()]);
  };
  const clearRef = useRef(clearSensitive);
  clearRef.current = clearSensitive;
  useEffect(() => {
    if (!suspended) return;
    handledDictationRequest.current = dictationRequest;
    void clearRef.current("Speech stopped while another dialog is open. Unsaved audio and transcript drafts were discarded.")
      .catch(() => { if (alive.current) setError("Speech cleanup failed. Close the panel and check OS microphone state."); });
  }, [suspended, dictationRequest]);
  useEffect(() => {
    alive.current = true;
    const previousScope = lifecycleScope.current;
    if (previousScope.pluginId !== pluginId || previousScope.workspaceScope !== workspaceScope || previousScope.path !== path) {
      void clearRef.current("Speech stopped when its note or vault changed.")
        .catch(() => { if (alive.current) setError("Speech cleanup failed. Close the panel and check OS microphone state."); });
    }
    lifecycleScope.current = { pluginId, workspaceScope, path };
    const cleanup = clearRef.current;
    const synth = window.speechSynthesis;
    const changed = () => {
      if (!synth || !alive.current) return;
      const local = synth.getVoices().filter((voice) => voice.localService === true);
      setVoices(local);
      setVoice((current) => local.some((voice) => voice.voiceURI === current) ? current : local[0]?.voiceURI ?? "");
    };
    changed();
    synth?.addEventListener("voiceschanged", changed);
    const blur = (event?: Event) => {
      if (event && event.target !== event.currentTarget) return;
      if (captureStateRef.current === "requesting" && !document.hidden) return;
      void clearRef.current("Speech stopped when this window became inactive. Unsaved audio and transcript drafts were discarded.")
        .catch(() => { if (alive.current) setError("Speech cleanup failed. Close the panel and check OS microphone state."); });
    };
    window.addEventListener("blur", blur);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !capture.current) return;
      event.preventDefault(); event.stopPropagation();
      if (captureStateRef.current === "requesting") {
        void clearRef.current().catch(() => { if (alive.current) setError("Microphone cleanup failed. Close the panel and check OS microphone state."); });
      } else void finishRef.current();
    };
    window.addEventListener("keydown", escape, true);
    const hidden = () => { if (document.hidden) blur(); };
    document.addEventListener("visibilitychange", hidden);
    const timer = window.setInterval(() => {
      if (capture.current) { setElapsed(capture.current.seconds); setLevel(capture.current.level); }
    }, 100);
    return () => {
      alive.current = false;
      synth?.removeEventListener("voiceschanged", changed);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
      document.removeEventListener("visibilitychange", hidden);
      window.clearInterval(timer);
      // StrictMode replays setup; preserve an explicit request that has not started yet.
      void cleanup(undefined, false).catch(() => console.error("Speech resource cleanup failed."));
    };
  }, [pluginId, workspaceScope, path]);
  const refreshEngine = async () => {
    const result = await api.speechEngineStatus(pluginId, workspaceScope);
    if (alive.current) setEngine(result);
  };
  useEffect(() => { void refreshEngine().catch((caught) => {
    handledDictationRequest.current = currentDictationRequest.current;
    queuedDictationRequest.current = null;
    if (alive.current) setError(errorMessage(caught));
  }); }, [pluginId, workspaceScope]);
  useEffect(() => {
    if (captureState === "requesting") cancelRecordingButton.current?.focus();
    else if (captureState === "recording") stopRecordingButton.current?.focus();
    else if (recorded) {
      const target = mode === "note" ? saveRecordingButton.current : transcribeButton.current;
      (target && !target.disabled ? target : modelSummary.current)?.focus();
    }
  }, [captureState, recorded]);
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    const revision = epoch.current;
    setBusy(true); setError(""); setStatus("");
    try { await action(); }
    catch (caught) { if (alive.current && revision === epoch.current) setError(errorMessage(caught)); }
    finally { if (alive.current && revision === epoch.current) setBusy(false); }
  };
  const speak = (selected: boolean) => {
    stopSpeech(); setError("");
    const chosen = voices.find((candidate) => candidate.voiceURI === voice && candidate.localService === true);
    if (!chosen || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setError("No installed local voice is available. Install an offline OS voice and reopen Speech."); return;
    }
    const range = selected ? captureSelection ? captureSelection() : selection : null;
    if (selected && (!range || range.source !== source || range.from === range.to)) {
      setError("Select text in the note, or use Read note aloud.");
      return;
    }
    const text = speechText(range ? source.slice(range.from, range.to) : source);
    const chunks = speechChunks(text);
    if (!chunks.length) { setError("There is no readable text in this selection or note."); return; }
    const revision = ttsEpoch.current;
    let index = 0;
    const next = () => {
      if (!alive.current || revision !== ttsEpoch.current) return;
      const chunk = chunks[index++];
      if (!chunk) { speakingRef.current = null; setSpeaking(null); return; }
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.voice = chosen; utterance.rate = rate;
      utterance.onend = next;
      utterance.onerror = () => {
        if (alive.current && revision === ttsEpoch.current) { stopSpeech(); setError("Local speech playback failed. Try another installed local voice."); }
      };
      if (speakingRef.current !== "paused") speakingRef.current = "playing";
      setSpeaking(speakingRef.current);
      window.speechSynthesis.speak(utterance);
    };
    next();
  };
  const start = async (kind: "note" | "dictation", requestedSelection?: AuthoringSelection | null) => {
    if (capture.current || finishingCapture.current || busy || readOnly || suspended) return;
    if (requestedSelection === undefined) {
      handledDictationRequest.current = currentDictationRequest.current;
      queuedDictationRequest.current = null;
    }
    setCapturedSelection(requestedSelection !== undefined ? requestedSelection : captureSelection ? captureSelection() : selection);
    stopSpeech(); clearAudio(); setTranscript(null); setDraft(""); setError(""); setMode(kind); setElapsed(0); setCaptureState("requesting");
    const revision = ++epoch.current;
    const instance = new SpeechCapture(
      () => { setStatus("The 10-minute limit was reached. Review and save or discard the recording."); void finishRef.current(); },
      (message) => { setError(message); void finishRef.current(false); },
    );
    capture.current = instance;
    try {
      await instance.start();
      if (!alive.current || revision !== epoch.current) { await instance.cancel(); return; }
      setCaptureState("recording");
    } catch (caught) {
      if (capture.current === instance) capture.current = null;
      if (alive.current && revision === epoch.current) { setCaptureState(null); setError(errorMessage(caught)); }
    }
  };
  const finish = async (shouldTranscribe = true) => {
    const instance = capture.current;
    if (!instance) return;
    capture.current = null;
    finishingCapture.current = instance;
    setCaptureState("finishing");
    const revision = epoch.current;
    try {
      const result = await instance.finish();
      if (!alive.current || revision !== epoch.current) { result.fill(0); return; }
      wav.current?.fill(0); wav.current = result;
      setRecorded(true); setCaptureState(null); setLevel(0);
      setStatus("Recording stopped. Review it before saving or transcribing.");
      if (mode === "dictation" && shouldTranscribe) transcribe();
    } catch (caught) {
      if (alive.current && revision === epoch.current) { setCaptureState(null); setError(errorMessage(caught)); }
    } finally { if (finishingCapture.current === instance) finishingCapture.current = null; }
  };
  finishRef.current = finish;
  const transcribe = () => void perform(async () => {
    const bytes = wav.current;
    if (!bytes || !engine?.installed) throw new Error("Record or import audio and download the local model first.");
    const revision = epoch.current;
    const id = crypto.randomUUID();
    operation.current = id;
    try {
      const result = await api.transcribeSpeech(pluginId, workspaceScope, id, speechBase64(bytes), locale);
      if (!alive.current || revision !== epoch.current || operation.current !== id) return;
      if (!result.text.trim()) throw new Error("The local engine found no speech. Keep the recording and try another locale or a clearer clip.");
      setTranscript(result); setDraft(result.text); setDraftEdited(false); setTimestamps(false);
      setStatus("Transcript ready for review. Nothing has been inserted.");
      window.requestAnimationFrame(() => transcriptInput.current?.focus());
    } finally { if (operation.current === id) operation.current = null; }
  });
  const dictationAction = useRef(() => {});
  dictationAction.current = () => {
    if (captureStateRef.current === "requesting") {
      void clearSensitive("Dictation cancelled before microphone access.")
        .catch((caught) => { if (alive.current) setError(errorMessage(caught)); });
      return;
    }
    if (busy || readOnly || suspended || finishingCapture.current) return;
    if (!engine?.installed) {
      setError(engine?.supported === false ? "Local dictation is unavailable on this operating system or architecture." :
        "Download the local model and engine before starting dictation.");
      const details = modelSummary.current?.closest("details");
      if (details) details.open = true;
      modelSummary.current?.focus();
      return;
    }
    if (capture.current) void finish();
    else void start("dictation", selection);
  };
  useEffect(() => {
    if (!dictationRequest || dictationRequest === handledDictationRequest.current) return;
    if (engine === null) {
      if (queuedDictationRequest.current !== null && queuedDictationRequest.current !== dictationRequest) {
        handledDictationRequest.current = dictationRequest;
        queuedDictationRequest.current = null;
        setStatus("Dictation cancelled before microphone access.");
      } else {
        queuedDictationRequest.current = dictationRequest;
        setStatus("Checking the local model before dictation…");
      }
      return;
    }
    queuedDictationRequest.current = null;
    handledDictationRequest.current = dictationRequest;
    dictationAction.current();
  }, [dictationRequest, engine]);

  return <SensitiveToolPanel title="Speech" feature="speech" onClose={onClose} onEscape={() => {
    if (captureStateRef.current === "requesting") void clearSensitive().catch((caught) => setError(errorMessage(caught)));
    else if (capture.current) void finish();
    else onClose();
  }}>
    <div className="sensitive-tool">
      <p className="authoring-muted">{path}. Local voices and transcription only. Plugin code never receives text or audio.</p>
      <p className="authoring-muted">{shortcutLabel} starts dictation. Press it again to stop and transcribe locally.</p>
      {onShortcutChange ? <details data-speech-shortcut-setting onFocusCapture={() => {
        if (queuedDictationRequest.current === null) return;
        handledDictationRequest.current = currentDictationRequest.current;
        queuedDictationRequest.current = null;
        setStatus("Pending dictation cancelled while editing its shortcut.");
      }}>
        <summary>Dictation shortcut</summary>
        <form className="speech-shortcut-form" onSubmit={(event) => { event.preventDefault(); configureShortcut(shortcutDraft); }}>
          <label>Dictation shortcut
            <input value={shortcutDraft} onChange={(event) => setShortcutDraft(event.currentTarget.value)}
              maxLength={80} autoComplete="off" spellCheck={false} disabled={busy || captureState !== null} />
          </label>
          <p className="authoring-muted">For example, Ctrl+Shift+D or Alt+Shift+D. Saved on this device. Existing app shortcuts cannot be replaced.</p>
          <div className="authoring-actions">
            <button type="submit" className="secondary-button" disabled={busy || captureState !== null}>Save shortcut</button>
            <button type="button" className="secondary-button" disabled={busy || captureState !== null}
              onClick={() => configureShortcut("Ctrl+Space")}>Use Ctrl+Space</button>
          </div>
          {captureState ? <p className="authoring-muted">Finish or cancel recording before changing its shortcut.</p> : null}
        </form>
      </details> : null}
      {error ? <p role="alert" className="authoring-error">{error}</p> : null}
      <p role="status">{status}</p>
      <section aria-label="Read aloud">
        <div className="authoring-actions">
          <label>Local voice <select value={voice} onChange={(event) => { stopSpeech(); setVoice(event.currentTarget.value); }} disabled={!voices.length}>
            {!voices.length ? <option value="">No installed local voices</option> : voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
          </select></label>
          <label>Speech rate <select value={rate} onChange={(event) => { stopSpeech(); setRate(Number(event.currentTarget.value)); }}>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
          </select></label>
          <button type="button" className="secondary-button" disabled={Boolean(captureState) || !voices.length} onClick={() => speak(false)}>Read note aloud</button>
          <button type="button" className="secondary-button" disabled={Boolean(captureState) || !voices.length ||
            !captureSelection && (!selection || selection.source !== source || selection.from === selection.to)} onClick={() => speak(true)}>Read selection aloud</button>
          {speaking ? <>
            <button type="button" className="secondary-button" onClick={() => {
              if (speaking === "playing") { speakingRef.current = "paused"; window.speechSynthesis.pause(); setSpeaking("paused"); }
              else { speakingRef.current = "playing"; window.speechSynthesis.resume(); setSpeaking("playing"); }
            }}>{speaking === "playing" ? "Pause speech" : "Resume speech"}</button>
            <button type="button" className="secondary-button" onClick={stopSpeech}>Stop speech</button>
          </> : null}
        </div>
        {!voices.length ? <p className="authoring-muted">No local voice is available. Install an offline OS voice; remote voices are not used.</p> : null}
      </section>
      <section aria-label="Microphone recording">
        <p className="authoring-muted">Only recording controls or {shortcutLabel} start the microphone. Recordings are limited to 10 minutes.</p>
        {captureState ? <div className="speech-recording" data-speech-capture>
          <strong role="status">{captureState === "requesting" ? "Requesting microphone access…" : captureState === "paused" ? "Recording paused" :
            captureState === "finishing" ? "Finishing recording…" : "Recording microphone audio"}</strong>
          <span role="timer" aria-live="off">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</span>
          <meter min={0} max={1} value={level} aria-label="Microphone input level" />
          <div className="authoring-actions">
            {captureState !== "requesting" ? <button type="button" className="secondary-button" disabled={captureState === "finishing"} onClick={() => {
              const paused = captureState !== "paused"; capture.current?.pause(paused); setCaptureState(paused ? "paused" : "recording");
            }}>{captureState === "paused" ? "Resume recording" : "Pause recording"}</button> : null}
            <button ref={stopRecordingButton} type="button" className="primary-button" onClick={() => void finish()} disabled={captureState === "requesting" || captureState === "finishing"}>Finish recording</button>
            <button ref={cancelRecordingButton} type="button" className="secondary-button" onClick={() => void clearSensitive().catch((caught) => setError(errorMessage(caught)))}>Cancel recording</button>
          </div>
          <small>Escape stops recording immediately.</small>
        </div> : <div className="authoring-actions">
          <button type="button" className={!recorded && !transcript && !engine?.installed ? "primary-button" : "secondary-button"} disabled={busy || readOnly} onClick={() => void start("note")}>Start recording</button>
          <button type="button" className={!recorded && !transcript && engine?.installed ? "primary-button" : "secondary-button"} disabled={busy || readOnly || !engine?.installed} onClick={() => void start("dictation")}>Start dictation</button>
          <label>Import audio <input type="file" accept=".wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.webm" disabled={busy} onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (!file) return;
            const revision = ++epoch.current;
            importController.current?.abort();
            const controller = new AbortController();
            importController.current = controller;
            setCapturedSelection(captureSelection ? captureSelection() : selection);
            clearAudio(); setTranscript(null); setDraft("");
            void perform(async () => {
              try {
                const result = await decodeSpeechFile(file, controller.signal);
                if (!alive.current || revision !== epoch.current) { result.fill(0); return; }
                wav.current = result; setRecorded(true); setMode("dictation"); setStatus("Local audio imported. Nothing was saved or sent.");
              } finally { if (importController.current === controller) importController.current = null; }
            });
          }} /></label>
        </div>}
        {recorded && wav.current ? <>
          <AudioPlayback key={epoch.current} label="Recorded or imported audio" load={async () => {
            if (!wav.current) throw new Error("The recording was discarded.");
            return { base64: speechBase64(wav.current), mime: "audio/wav" };
          }} />
          <div className="authoring-actions">
            {mode === "note" ? <button ref={saveRecordingButton} type="button" className={transcript ? "secondary-button" : "primary-button"} disabled={busy || readOnly} onClick={() => void perform(async () => {
              if (!wav.current) throw new Error("The recording is no longer available.");
              const accepted = wav.current.slice();
              try { await onSaveVoiceNote(accepted, insertion.from, insertion.to); }
              finally { accepted.fill(0); }
              clearAudio(); setStatus("Voice note saved and linked in the note.");
            })}>Save voice note</button> : null}
            <button ref={transcribeButton} type="button" className="secondary-button" disabled={busy || !engine?.installed} onClick={transcribe}>Transcribe audio locally</button>
            <button type="button" className="secondary-button" onClick={() => { clearAudio(); setTranscript(null); setDraft(""); }}>Discard audio</button>
          </div>
        </> : null}
      </section>
      {transcript ? <section aria-label="Transcript review">
        <label className="sensitive-tool__check"><input type="checkbox" checked={timestamps} disabled={!transcript.words.length || draftEdited}
          onChange={(event) => { const checked = event.currentTarget.checked; setTimestamps(checked); setDraft(checked ? timestampedTranscript(transcript) : transcript.text); }} />Include returned timestamps</label>
        {draftEdited ? <p className="authoring-muted">Your edits are kept. Choose timestamps before editing, or transcribe again to start over.</p> : null}
        <label>Review transcript<textarea ref={transcriptInput} value={draft} rows={7} maxLength={1024 * 1024} onChange={(event) => { setDraft(event.currentTarget.value); setDraftEdited(true); }} /></label>
        <p className="authoring-muted">{insertion.append ? "The transcript will be added to the end of this note." :
          insertion.from === insertion.to ? "The transcript will be inserted at the captured caret." : "The transcript will replace the captured selection."} Review recognition errors before inserting.</p>
        <p className="authoring-muted">Speaker labels require a separate diarization model and are not inferred.</p>
        <div className="authoring-actions">
          <button type="button" className="primary-button" disabled={busy || readOnly || !draft.trim()} onClick={() => {
            try {
              onInsert(insertion.prefix + draft, insertion.from, insertion.to);
              setDraft(""); setTranscript(null); clearAudio(); onClose();
            } catch (caught) { setError(errorMessage(caught)); }
          }}>Insert transcript</button>
          <button type="button" className="secondary-button" onClick={() => { setDraft(""); setTranscript(null); }}>Discard transcript</button>
        </div>
      </section> : null}
      <details>
        <summary ref={modelSummary}>Local transcription model</summary>
        <p>NVIDIA Nemotron 3.5 ASR Streaming 0.6B. About 742 MB plus the CPU runtime. No GPU or remote provider is required.</p>
        {engine?.supported === false ? <p role="status">Local Nemotron inference is unavailable for this operating system or architecture. Available local voices and recording remain separate.</p> : null}
        <p className="authoring-muted">Model: huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b. License: OpenMDW 1.1 at openmdw.ai/license/1-1/. Runtime: NVIDIA/NeMo-Speech.cpp 0.2.0, Apache-2.0.</p>
        <label>Transcription locale <select value={locale} onChange={(event) => setLocale(event.currentTarget.value)} disabled={busy}>
          {(engine?.locales ?? ["auto"]).map((locale) => <option key={locale} value={locale}>{locale === "auto" ? "Automatic language detection" : locale}</option>)}
        </select></label>
        {engine?.installed ? <p role="status">Verified local model installed.</p> : <>
          {engine?.modelCached ? <p>The verified model is cached. Only the native runtime needs downloading.</p> : null}
          <label className="sensitive-tool__check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.currentTarget.checked)} disabled={busy} />
            I approve this download and the model license ({engine ? ((engine.modelBytes + engine.runtimeBytes) / 1000000).toFixed(1) : "about 750"} MB).
          </label>
          <button type="button" className="secondary-button" disabled={!approved || busy || engine?.supported === false} onClick={() => void perform(async () => {
            const id = crypto.randomUUID(); operation.current = id;
            try {
              await api.installSpeechEngine(pluginId, workspaceScope, id, approved, (progress) => { if (alive.current && operation.current === id) setProgress(progress); });
              if (alive.current && operation.current === id) { await refreshEngine(); setStatus("Verified local speech model installed."); }
            } finally { if (operation.current === id) operation.current = null; }
          })}>Download local model and engine</button>
        </>}
        {progress ? <p role="status">{progress.phase === "ready" ? "Download verified." : `Downloading ${Math.round(progress.downloadedBytes / 1000000)} / ${Math.round(progress.totalBytes / 1000000)} MB…`}</p> : null}
        {busy && operation.current ? <button type="button" className="secondary-button" onClick={() => void cancelOperation().catch((caught) => setError(errorMessage(caught)))}>Cancel speech operation</button> : null}
        <label className="sensitive-tool__check"><input type="checkbox" checked={removeApproved} onChange={(event) => setRemoveApproved(event.currentTarget.checked)} />
          Remove downloaded model and runtime, without changing audio or notes.
        </label>
        <button type="button" className="secondary-button" disabled={!removeApproved || busy} onClick={() => void perform(async () => {
          await api.removeSpeechEngine(pluginId, workspaceScope, removeApproved); setRemoveApproved(false); setApproved(false); setProgress(null); await refreshEngine();
        })}>Remove local model and engine</button>
      </details>
      <details>
        <summary>Unfinished audio recovery</summary>
        <p>Interrupted saves keep a private recovery record. Unknown or changed files are never guessed away. If recovery is blocked, you can keep every file and clear only the recovery metadata.</p>
        <label className="sensitive-tool__check"><input type="checkbox" checked={keepRecoveryApproved}
          onChange={(event) => setKeepRecoveryApproved(event.currentTarget.checked)} />
          I will review retained files in the note's assets folder myself.
        </label>
        <button type="button" className="secondary-button" disabled={!keepRecoveryApproved || busy || Boolean(captureState)}
          onClick={() => void perform(async () => {
            await api.keepUnfinishedSpeechAudio(pluginId, workspaceScope, keepRecoveryApproved);
            setKeepRecoveryApproved(false); setStatus("Recovery metadata cleared. Notes and audio files were kept.");
            await refreshEngine();
          })}>Keep unfinished audio</button>
      </details>
    </div>
  </SensitiveToolPanel>;
}
