import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Search, Smile, Star, X } from "lucide-react";
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

export const EmojiHostSurface = memo(function EmojiHostSurface({ host }: { host: EmojiHost }) {
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
});

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
  const filteredEntries = useMemo(() => index.search(query, category), [category, index, query]);
  const collectionResults = useMemo(() => {
    if (collection !== "all") {
      const values = collection === "recent" ? preferences.recents : preferences.favorites;
      const permitted = new Set(filteredEntries);
      return values.flatMap((value) => {
        const match = index.byUnicode.get(value);
        return match && permitted.has(match.entry) ? [match] : [];
      });
    }
    return null;
  }, [collection, filteredEntries, index, preferences.recents, preferences.favorites]);
  const resultCount = collectionResults?.length ?? filteredEntries.length;
  const pages = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
  const actualPage = Math.min(page, pages - 1);
  const visible = useMemo(() => collectionResults
    ? collectionResults.slice(actualPage * PAGE_SIZE, (actualPage + 1) * PAGE_SIZE)
    : filteredEntries.slice(actualPage * PAGE_SIZE, (actualPage + 1) * PAGE_SIZE)
      .map((entry) => emojiForTone(entry, preferences.tone)),
  [actualPage, collectionResults, filteredEntries, preferences.tone]);
  const current = selected ?? visible[Math.min(active, visible.length - 1)] ?? null;
  const currentIsFavorite = current
    ? preferences.favorites.includes(current.unicode)
    : false;
  const resultStatus = resultCount
    ? `${resultCount} emoji. Page ${actualPage + 1} of ${pages}.`
    : "No emoji found. Try another search or category.";
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
    if (!visible.length) return false;
    let next = active;
    if (key === "ArrowRight" || key === "ArrowDown") next = (active + 1) % visible.length;
    else if (key === "ArrowLeft" || key === "ArrowUp") next = (active + visible.length - 1) % visible.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = visible.length - 1;
    else return false;
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
    <header className="emoji-picker__header">
      <div>
        <span className="emoji-picker__eyebrow">Insert symbol</span>
        <h2 id={`${id}-title`}>{picker.title}</h2>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Close emoji picker"
        onClick={() => host.close()}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
    <div className="emoji-picker__search">
      <Search size={16} aria-hidden="true" />
      <label className="sr-only" htmlFor={`${id}-search`}>
        Search emoji
      </label>
      <input
        id={`${id}-search`}
        ref={inputRef}
        value={query}
        maxLength={100}
        autoComplete="off"
        placeholder="Search names, keywords, or :shortcodes:"
        onChange={(event) => { setQuery(event.target.value); reset(); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (["ArrowDown", "ArrowUp"].includes(event.key) && move(event.key, true)) event.preventDefault();
          if (event.key === "Enter" && current) { event.preventDefault(); host.choose(current); }
        }}
      />
    </div>
    <fieldset className="emoji-picker__filters">
      <legend className="sr-only">Emoji filters</legend>
      <label className="emoji-picker__field" htmlFor={`${id}-collection`}>
        <span>Show</span>
        <select
          id={`${id}-collection`}
          value={collection}
          onChange={(event) => { setCollection(event.target.value); reset(); }}
        >
          <option value="all">All emoji</option>
          <option value="recent">Recents</option>
          <option value="favorites">Favorites</option>
        </select>
      </label>
      <label className="emoji-picker__field" htmlFor={`${id}-category`}>
        <span>Category</span>
        <select
          id={`${id}-category`}
          value={category}
          onChange={(event) => { setCategory(event.target.value); reset(); }}
        >
          <option value="">All categories</option>
          {index.categories.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      <label className="emoji-picker__field" htmlFor={`${id}-tone`}>
        <span>Skin tone</span>
        <select
          id={`${id}-tone`}
          value={preferences.tone}
          onChange={(event) => {
            save({ ...preferences, tone: Number(event.target.value) });
            setSelected(null);
          }}
        >
          {["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"].map((name, value) => (
            <option key={value} value={value}>{name}</option>
          ))}
        </select>
      </label>
    </fieldset>
    <section className="emoji-picker__browser" aria-label="Emoji browser">
      <div className="emoji-picker__results-header">
        <p id={`${id}-status`} role="status">{resultStatus}</p>
        <span id={`${id}-navigation-hint`}>
          Arrow keys move. Enter inserts.
        </span>
      </div>
      <ul
        ref={resultsRef}
        className="emoji-picker__results"
        aria-label="Emoji results"
        aria-describedby={`${id}-status ${id}-navigation-hint`}
        onKeyDown={(event) => { if (move(event.key, true)) event.preventDefault(); }}
      >
        {visible.map((match, position) => (
          <li key={match.unicode}>
            <button
              type="button"
              className="emoji-picker__emoji"
              data-active={position === active}
              title={match.name}
              aria-label={`Insert ${match.name}`}
              tabIndex={position === active ? 0 : -1}
              onMouseEnter={() => {
                setActive(position);
                setSelected(null);
              }}
              onFocus={() => {
                setActive(position);
                setSelected(null);
              }}
              onClick={() => host.choose(match)}
            >
              <span aria-hidden="true">{match.unicode}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
    {current ? (
      <section className="emoji-picker__selection" aria-label="Selected emoji">
        <span className="emoji-picker__selection-glyph" aria-hidden="true">
          {current.unicode}
        </span>
        <div className="emoji-picker__selection-copy">
          <strong>{current.name}</strong>
          <span>{current.entry.category}</span>
        </div>
        <button
          type="button"
          className="secondary-button emoji-picker__favorite"
          aria-pressed={currentIsFavorite}
          aria-label={`${currentIsFavorite ? "Remove" : "Add"} ${current.name} ${currentIsFavorite ? "from" : "to"} favorites`}
          onClick={() => save({
            ...preferences,
            favorites: currentIsFavorite
              ? preferences.favorites.filter((value) => value !== current.unicode)
              : [...preferences.favorites, current.unicode].slice(-EMOJI_MAX_FAVORITES),
          })}
        >
          <Star
            size={15}
            fill={currentIsFavorite ? "currentColor" : "none"}
            aria-hidden="true"
          />
          {currentIsFavorite ? "Favorited" : "Favorite"}
        </button>
        {current.entry.variants.length > 0 ? (
          <label
            className="emoji-picker__field emoji-picker__variant"
            htmlFor={`${id}-variant`}
          >
            <span>Variant</span>
            <select
              id={`${id}-variant`}
              value={current.unicode}
              onChange={(event) =>
                setSelected(index.byUnicode.get(event.target.value) ?? null)
              }
            >
              <option value={current.entry.unicode}>{current.entry.name}</option>
              {current.entry.variants.map((variant) => (
                <option key={variant.unicode} value={variant.unicode}>
                  {variant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="primary-button emoji-picker__insert"
          onClick={() => host.choose(current)}
        >
          Insert emoji
        </button>
      </section>
    ) : null}
    <footer className="emoji-picker__footer">
      <span>
        Page {actualPage + 1} of {pages}
      </span>
      <div>
        <button
          type="button"
          className="secondary-button"
          disabled={actualPage === 0}
          onClick={() => {
            setPage(actualPage - 1);
            setActive(0);
            setSelected(null);
          }}
        >
          <ChevronLeft size={15} aria-hidden="true" />
          Previous page
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={actualPage + 1 === pages}
          onClick={() => {
            setPage(actualPage + 1);
            setActive(0);
            setSelected(null);
          }}
        >
          Next page
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => host.close()}
        >
          Cancel
        </button>
      </div>
    </footer>
  </dialog>;
}
