import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Smile, Star, X } from "lucide-react";
import { EMOJI_MAX_FAVORITES, type PluginEmojiPreferences } from "@denote/plugin-sdk";
import { emojiForTone, emojiIndex, type EmojiContribution, type EmojiMatch } from "../lib/emoji";
import type { EmojiHost } from "../lib/emojiHost";
import "./EmojiPicker.css";

const PAGE_SIZE = 48;

export function EmojiToolbar({ host, pickers, disabled = false, scope }: {
  host: EmojiHost;
  pickers: EmojiContribution[];
  disabled?: boolean;
  scope?: string;
}) {
  if (!pickers.length) return null;
  return <div className="emoji-toolbar">
    {pickers.map((picker) => <button
      key={`${picker.pluginId}:${picker.id}`}
      type="button"
      className="editor-toolbar-button"
      aria-label={picker.title}
      title={`${picker.title} (Command-Shift-E / Ctrl-Shift-E)`}
      aria-haspopup="dialog"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => host.open(picker, scope)}
    ><Smile size={16} aria-hidden="true" /><span>{picker.title}</span></button>)}
  </div>;
}

export function EmojiHostSurface({ host }: { host: EmojiHost }) {
  const state = useSyncExternalStore(host.subscribe, host.getSnapshot);
  if (state.picker) return <EmojiPicker key={`${state.picker.pluginId}:${state.picker.id}`} host={host} picker={state.picker} />;
  if (!state.suggestion) return null;
  const { matches, active, adapter, candidate } = state.suggestion;
  const options = matches.map((match) => {
    const alias = match.entry.shortcodes.find((shortcode) => shortcode.toLowerCase().startsWith(candidate.query.toLowerCase()))
      ?? match.entry.shortcodes[0];
    const shortcode = alias ? `:${alias}:` : "";
    return { match, shortcode, label: shortcode ? `${shortcode} ${match.name}` : match.name };
  });
  const bounds = adapter.element()?.getBoundingClientRect();
  return <div
    className="emoji-suggestions"
    aria-label="Emoji suggestions"
    style={{ top: Math.min((bounds?.top ?? 80) + 32, window.innerHeight - 360), left: Math.max(8, Math.min(bounds?.left ?? 20, window.innerWidth - 300)) }}
  >
    <p role="status">{options[active].label}. Use arrow keys, Enter to insert, Escape to dismiss.</p>
    <ul>
      {options.map(({ match, shortcode, label }, index) => <li key={match.unicode}>
        <button
          type="button"
          className={index === active ? "emoji-suggestion--active" : ""}
          aria-label={`Insert ${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => host.choose(match)}
        >
          <span className="emoji-suggestion__glyph" aria-hidden="true">{match.unicode}</span>
          <span className="emoji-suggestion__text">
            {shortcode && <span>{shortcode}</span>}
            <span className="emoji-suggestion__name">{match.name}</span>
          </span>
        </button>
      </li>)}
    </ul>
  </div>;
}

function EmojiPicker({ host, picker }: { host: EmojiHost; picker: EmojiContribution }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const index = useMemo(() => emojiIndex(picker), [picker.entries]);
  const [preferences, setPreferences] = useState(() => host.preferences(picker));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [collection, setCollection] = useState("all");
  const [page, setPage] = useState(0);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<EmojiMatch | null>(null);
  const results = useMemo(() => {
    if (collection !== "all") {
      const values = collection === "recent" ? preferences.recents : preferences.favorites;
      const permitted = new Set(index.search(query, category));
      return values.flatMap((value) => {
        const match = index.byUnicode.get(value);
        return match && permitted.has(match.entry) ? [match] : [];
      });
    }
    return index.search(query, category).map((entry) => emojiForTone(entry, preferences.tone));
  }, [category, collection, index, preferences, query]);
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const actualPage = Math.min(page, pages - 1);
  const visible = results.slice(actualPage * PAGE_SIZE, (actualPage + 1) * PAGE_SIZE);
  const current = selected ?? visible[Math.min(active, visible.length - 1)] ?? null;
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => { dialog?.close(); };
  }, []);
  const save = (next: PluginEmojiPreferences) => {
    setPreferences(next);
    host.save(picker, next);
  };
  const reset = () => { setPage(0); setActive(0); setSelected(null); };
  const move = (key: string, focus: boolean) => {
    let next = active;
    if (key === "ArrowRight" || key === "ArrowDown") next = (active + 1) % visible.length;
    else if (key === "ArrowLeft" || key === "ArrowUp") next = (active + visible.length - 1) % visible.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = visible.length - 1;
    else return false;
    if (!visible.length) return false;
    setActive(next); setSelected(null);
    if (focus) resultsRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    return true;
  };
  return <dialog
    ref={dialogRef}
    className="app-dialog emoji-picker"
    aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); host.close(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); host.close(); }
    }}
  >
    <header><h2 id={`${id}-title`}>{picker.title}</h2><button type="button" className="icon-button" aria-label="Close emoji picker" onClick={() => host.close()}><X size={18} aria-hidden="true" /></button></header>
    <label htmlFor={`${id}-search`}>Search emoji</label>
    <input id={`${id}-search`} ref={inputRef} value={query} maxLength={100} autoComplete="off"
      onChange={(event) => { setQuery(event.target.value); reset(); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (["ArrowDown", "ArrowUp"].includes(event.key) && move(event.key, true)) event.preventDefault();
        if (event.key === "Enter" && current) { event.preventDefault(); host.choose(current); }
      }}
    />
    <div className="emoji-picker__filters">
      <label>Show<select value={collection} onChange={(event) => { setCollection(event.target.value); reset(); }}>
        <option value="all">All emoji</option><option value="recent">Recents</option><option value="favorites">Favorites</option>
      </select></label>
      <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); reset(); }}>
        <option value="">All categories</option>{index.categories.map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <label>Skin tone<select value={preferences.tone} onChange={(event) => { save({ ...preferences, tone: Number(event.target.value) }); setSelected(null); }}>
        {["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"].map((name, value) => <option key={value} value={value}>{name}</option>)}
      </select></label>
    </div>
    <p role="status">{results.length ? `${results.length} emoji. Page ${actualPage + 1} of ${pages}.` : "No emoji found. Try another search or category."}</p>
    <ul ref={resultsRef} className="emoji-picker__results" aria-label="Emoji results"
      onKeyDown={(event) => { if (move(event.key, true)) event.preventDefault(); }}
    >
      {visible.map((match, position) => <li key={match.unicode}><button
        type="button" title={match.name} aria-label={`Insert ${match.name}`} tabIndex={position === active ? 0 : -1}
        onFocus={() => { setActive(position); setSelected(null); }}
        onClick={() => host.choose(match)}
      ><span aria-hidden="true">{match.unicode}</span></button></li>)}
    </ul>
    {current && <div className="emoji-picker__selection">
      <span>{current.name}</span>
      <button type="button" aria-pressed={preferences.favorites.includes(current.unicode)}
        aria-label={`${preferences.favorites.includes(current.unicode) ? "Remove" : "Add"} ${current.name} ${preferences.favorites.includes(current.unicode) ? "from" : "to"} favorites`}
        onClick={() => save({ ...preferences, favorites: preferences.favorites.includes(current.unicode)
          ? preferences.favorites.filter((value) => value !== current.unicode)
          : [...preferences.favorites, current.unicode].slice(-EMOJI_MAX_FAVORITES) })}
      ><Star size={16} aria-hidden="true" />Favorite</button>
      {current.entry.variants.length > 0 && <label>Variant<select value={current.unicode} onChange={(event) => setSelected(index.byUnicode.get(event.target.value) ?? null)}>
        <option value={current.entry.unicode}>{current.entry.name}</option>
        {current.entry.variants.map((variant) => <option key={variant.unicode} value={variant.unicode}>{variant.name}</option>)}
      </select></label>}
      <button type="button" onClick={() => host.choose(current)}>Insert emoji</button>
    </div>}
    <footer>
      <button type="button" disabled={actualPage === 0} onClick={() => { setPage(actualPage - 1); setActive(0); setSelected(null); }}>Previous page</button>
      <button type="button" disabled={actualPage + 1 === pages} onClick={() => { setPage(actualPage + 1); setActive(0); setSelected(null); }}>Next page</button>
      <button type="button" onClick={() => host.close()}>Cancel</button>
    </footer>
  </dialog>;
}
