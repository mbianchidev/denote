import { EMOJI_MAX_RECENTS, type PluginEmojiPreferences } from "@denote/plugin-sdk";
import { emojiForTone, emojiIndex, type EmojiCandidate, type EmojiContribution, type EmojiMatch } from "./emoji";

export function isEmojiPickerShortcut(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "key" | "code">, platform: string): boolean {
  const primary = /Mac|iPhone|iPad|iPod/i.test(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return primary && event.shiftKey && !event.altKey && !event.isComposing &&
    (event.code === "KeyE" || !event.code && event.key.toLowerCase() === "e");
}

export interface EmojiBookmark {
  valid(): boolean;
  insert(unicode: string): boolean;
  restore(): void;
}
export interface EmojiEditorAdapter {
  scope: string;
  element(): HTMLElement | null;
  capture(candidate?: EmojiCandidate): EmojiBookmark | null;
}
export interface EmojiEditorBinding {
  host: EmojiHost;
  scope: string;
  prepareSource?(document: string, from: number, to: number, unicode: string): boolean;
}
export interface EmojiSuggestion {
  picker: EmojiContribution;
  matches: EmojiMatch[];
  candidate: EmojiCandidate;
  bookmark: EmojiBookmark;
  adapter: EmojiEditorAdapter;
  active: number;
}
export interface EmojiHostState {
  picker: EmojiContribution | null;
  bookmark: EmojiBookmark | null;
  suggestion: EmojiSuggestion | null;
}
interface EmojiHostConfig {
  pickers: EmojiContribution[];
  allowed(scope: string): boolean;
  preferences(picker: EmojiContribution): PluginEmojiPreferences;
  save(picker: EmojiContribution, preferences: PluginEmojiPreferences): void | Promise<void>;
  error(message: string): void;
}

/** Private renderer bridge. No adapter, query, selection, or document reaches a worker. */
export class EmojiHost {
  private adapters = new Set<EmojiEditorAdapter>();
  private active: EmojiEditorAdapter | null = null;
  private activeByScope = new Map<string, EmojiEditorAdapter>();
  private listeners = new Set<() => void>();
  private dismissed: string | null = null;
  private pendingPreferences = new WeakMap<EmojiContribution, PluginEmojiPreferences>();
  private config: EmojiHostConfig = {
    pickers: [], allowed: () => false,
    preferences: () => ({ recents: [], favorites: [], tone: 0 }),
    save: () => {}, error: () => {},
  };
  private state: EmojiHostState = { picker: null, bookmark: null, suggestion: null };
  getSnapshot = () => this.state;
  isPickerOpen = () => this.state.picker !== null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  configure(config: EmojiHostConfig) {
    this.config = config;
  }
  reconcile() {
    const { picker, suggestion, bookmark } = this.state;
    if ((picker && (!this.available(picker) || !bookmark?.valid())) ||
        (suggestion && (!this.available(suggestion.picker) || !suggestion.bookmark.valid()))) {
      this.close(false);
    }
  }
  private set(state: EmojiHostState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  private available(picker: EmojiContribution) {
    return this.config.pickers.includes(picker);
  }
  allowed(scope: string) { return this.config.pickers.length > 0 && this.config.allowed(scope); }
  register(adapter: EmojiEditorAdapter) {
    this.adapters.add(adapter);
    return () => {
      this.adapters.delete(adapter);
      if (this.active === adapter) this.active = null;
      if (this.activeByScope.get(adapter.scope) === adapter) this.activeByScope.delete(adapter.scope);
      if (this.state.suggestion?.adapter === adapter || this.state.bookmark && !this.state.bookmark.valid()) this.close(false);
    };
  }
  activate(adapter: EmojiEditorAdapter) {
    if (this.active !== adapter) {
      this.dismissed = null;
      if (this.state.suggestion) this.set({ ...this.state, suggestion: null });
    }
    this.active = adapter;
    this.activeByScope.set(adapter.scope, adapter);
  }
  open(picker: EmojiContribution, scope?: string) {
    if (!this.available(picker)) return;
    let adapter = scope ? this.activeByScope.get(scope) : this.active;
    if (!adapter || !this.adapters.has(adapter) || !this.allowed(adapter.scope) || !adapter.capture()?.valid()) {
      adapter = [...this.adapters].reverse().find((item) =>
        (!scope || item.scope === scope) && this.allowed(item.scope) && item.capture()?.valid(),
      );
    }
    if (!adapter) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && (focused.isContentEditable || focused.getAttribute("contenteditable") === "true") &&
        focused.closest<HTMLElement>(".mdxeditor-rich-text-editor")?.style.display !== "none" &&
        adapter.element() !== focused &&
        (!scope || focused.closest(".workspace-pane") === adapter.element()?.closest(".workspace-pane"))) return;
    const bookmark = adapter.capture();
    if (bookmark?.valid()) this.set({ picker, bookmark, suggestion: null });
  }
  preferences(picker: EmojiContribution) { return this.pendingPreferences.get(picker) ?? this.config.preferences(picker); }
  save(picker: EmojiContribution, preferences: PluginEmojiPreferences) {
    if (!this.available(picker)) return;
    this.pendingPreferences.set(picker, preferences);
    const clear = () => {
      if (this.pendingPreferences.get(picker) === preferences) this.pendingPreferences.delete(picker);
    };
    try {
      void Promise.resolve(this.config.save(picker, preferences)).then(clear, (error: unknown) => {
        clear();
        this.config.error(error instanceof Error ? error.message : "Unable to save emoji preferences.");
      });
    } catch (error) {
      clear();
      this.config.error(error instanceof Error ? error.message : "Unable to save emoji preferences.");
    }
  }
  choose(match: EmojiMatch) {
    const picker = this.state.picker ?? this.state.suggestion?.picker;
    const bookmark = this.state.bookmark ?? this.state.suggestion?.bookmark;
    if (!picker || !this.available(picker) || !bookmark?.valid()) { this.close(false); return; }
    // Clear the UI before the editor transaction, whose update listener can run synchronously.
    this.set({ picker: null, bookmark: null, suggestion: null });
    if (!bookmark.insert(match.unicode)) {
      this.config.error("The emoji could not be inserted safely. Place the caret in Markdown text and try again.");
      queueMicrotask(() => { if (bookmark.valid()) bookmark.restore(); });
      return;
    }
    const preferences = this.preferences(picker);
    this.save(picker, { ...preferences, recents: [match.unicode, ...preferences.recents.filter((value) => value !== match.unicode)].slice(0, EMOJI_MAX_RECENTS) });
  }
  close(restore = true) {
    const bookmark = this.state.bookmark ?? this.state.suggestion?.bookmark;
    if (!this.state.picker && !this.state.suggestion && !bookmark) return;
    this.set({ picker: null, bookmark: null, suggestion: null });
    if (restore && bookmark?.valid()) queueMicrotask(() => { if (bookmark.valid()) bookmark.restore(); });
  }
  suggest(adapter: EmojiEditorAdapter, candidate: EmojiCandidate | null) {
    if (this.state.picker) return;
    const key = candidate ? `${adapter.scope}:${candidate.from}:${candidate.query}` : null;
    if (this.dismissed !== key) this.dismissed = null;
    if (!candidate || !this.allowed(adapter.scope) || this.dismissed === key) {
      if (this.state.suggestion) this.set({ ...this.state, suggestion: null });
      return;
    }
    this.activate(adapter);
    for (const picker of this.config.pickers) {
      if (!picker.shortcodes) continue;
      const tone = this.preferences(picker).tone;
      const matches = emojiIndex(picker).suggest(candidate.query).map((entry) => emojiForTone(entry, tone));
      if (!matches.length) continue;
      const bookmark = adapter.capture(candidate);
      if (bookmark) this.set({ picker: null, bookmark: null, suggestion: { picker, matches, candidate, bookmark, adapter, active: 0 } });
      return;
    }
    if (this.state.suggestion) this.set({ ...this.state, suggestion: null });
  }
  key(event: KeyboardEvent): boolean {
    const suggestion = this.state.suggestion;
    if (!suggestion || event.isComposing || event.keyCode === 229) return false;
    if (!suggestion.bookmark.valid()) { this.close(false); return false; }
    let active = suggestion.active;
    if (event.key === "Escape") {
      this.dismissed = `${suggestion.adapter.scope}:${suggestion.candidate.from}:${suggestion.candidate.query}`;
      this.close();
    } else if (event.key === "Enter") {
      queueMicrotask(() => {
        if (this.state.suggestion === suggestion) this.choose(suggestion.matches[active]);
      });
    }
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") active = (active + 1) % suggestion.matches.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") active = (active + suggestion.matches.length - 1) % suggestion.matches.length;
    else if (event.key === "Home") active = 0;
    else if (event.key === "End") active = suggestion.matches.length - 1;
    else return false;
    event.preventDefault();
    if (active !== suggestion.active) this.set({ ...this.state, suggestion: { ...suggestion, active } });
    return true;
  }
}
