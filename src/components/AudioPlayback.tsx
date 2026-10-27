import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import { audioBytes } from "../lib/speech";

let activePlayback: { owner: symbol; unload: () => void } | null = null;

export interface AudioResource { base64: string; mime: string }

export function AudioPlayback({ label, load, onExport }: {
  label: string;
  load: () => Promise<AudioResource>;
  onExport?: () => Promise<boolean>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const owner = useRef(Symbol("audio-playback")).current;
  const resource = useRef<{ url: string; bytes: Uint8Array } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [status, setStatus] = useState("");
  const alive = useRef(true);
  const sequence = useRef(0);
  const unload = () => {
    ++sequence.current;
    const element = audio.current;
    if (element) { element.pause(); element.removeAttribute("src"); element.load(); }
    if (resource.current) { URL.revokeObjectURL(resource.current.url); resource.current.bytes.fill(0); resource.current = null; }
    if (activePlayback?.owner === owner) activePlayback = null;
    if (alive.current) { setLoaded(false); setPlaying(false); setLoading(false); setTime(0); setDuration(0); }
  };
  const unloadRef = useRef(unload);
  unloadRef.current = unload;
  useEffect(() => {
    alive.current = true;
    const stop = () => unloadRef.current();
    window.addEventListener("denote:speech-stop", stop);
    window.addEventListener("blur", stop);
    return () => {
      alive.current = false;
      window.removeEventListener("denote:speech-stop", stop);
      window.removeEventListener("blur", stop);
      unloadRef.current();
    };
  }, []);
  const play = async () => {
    const element = audio.current;
    if (!element || loading) return;
    const revision = ++sequence.current;
    setError("");
    try {
      if (!resource.current) {
        setLoading(true);
        const result = await load();
        const bytes = audioBytes(result.base64);
        if (!alive.current || revision !== sequence.current) { bytes.fill(0); return; }
        if (activePlayback?.owner !== owner) activePlayback?.unload();
        activePlayback = { owner, unload: () => unloadRef.current() };
        const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
        resource.current = { url, bytes };
        element.src = url;
        setLoaded(true);
      }
      element.playbackRate = rate;
      element.volume = volume;
      await element.play();
      if (alive.current && revision === sequence.current) setPlaying(true);
    } catch (caught) {
      if (alive.current && revision === sequence.current) {
        setError(caught instanceof DOMException && caught.name === "NotSupportedError"
          ? "This audio format cannot play on this platform. Use the ordinary link or export it." : errorMessage(caught));
      }
    } finally { if (alive.current && revision === sequence.current) setLoading(false); }
  };
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return <span className="audio-playback" role="group" aria-label={`Audio: ${label}`}>
    <audio ref={audio} preload="metadata" onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)}
      onLoadedMetadata={() => setDuration(Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0)}
      onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => { if (alive.current && resource.current) setError("Audio playback failed. Use the ordinary link or export it."); }} />
    <button type="button" className="secondary-button" disabled={loading} aria-label={`${playing ? "Pause" : "Play"} audio: ${label}`}
      onClick={() => playing ? audio.current?.pause() : void play()}>{loading ? "Loading audio…" : playing ? "Pause audio" : "Play audio"}</button>
    <label>Seek <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(time, duration || 1)} disabled={!loaded || !duration}
      aria-label={`Seek audio: ${label}`} onChange={(event) => {
        const next = Number(event.currentTarget.value); if (audio.current) audio.current.currentTime = next; setTime(next);
      }} /></label>
    <span role="timer" aria-live="off">{clock(time)} / {clock(duration)}</span>
    <label>Volume <input type="range" min={0} max={1} step={0.05} value={volume} aria-label={`Audio volume: ${label}`}
      onChange={(event) => { const next = Number(event.currentTarget.value); setVolume(next); if (audio.current) audio.current.volume = next; }} /></label>
    <label>Playback speed <select value={rate} aria-label={`Playback speed: ${label}`} onChange={(event) => {
      const next = Number(event.currentTarget.value); setRate(next); if (audio.current) audio.current.playbackRate = next;
    }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}</select></label>
    {onExport ? <button type="button" className="secondary-button" onClick={() => setConfirmExport(true)}>Download audio</button> : null}
    {confirmExport && onExport ? <span className="authoring-actions" role="group" aria-label="Export unencrypted audio?">
      <span>The exported file will not be encrypted by Denote.</span>
      <button type="button" className="secondary-button" onClick={() => setConfirmExport(false)}>Cancel export</button>
      <button type="button" className="secondary-button" disabled={exporting} onClick={() => {
        setExporting(true); setError("");
        void onExport().then((saved) => {
          if (alive.current) { setStatus(saved ? "Unencrypted audio exported." : "Audio export cancelled."); setConfirmExport(false); }
        }).catch((caught) => { if (alive.current) setError(errorMessage(caught)); })
          .finally(() => { if (alive.current) setExporting(false); });
      }}>Export unencrypted audio</button>
    </span> : null}
    {error ? <span role="alert" className="authoring-error">{error}</span> : null}
    {status ? <span role="status">{status}</span> : null}
  </span>;
}
