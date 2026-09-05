import { isolateHistory } from "@codemirror/commands";
import { language, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Prec, Transaction, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { MAX_EMOJI_SHORTCODE_LENGTH, emojiCandidate, type EmojiCandidate } from "./emoji";
import type { EmojiBookmark, EmojiEditorAdapter, EmojiEditorBinding } from "./emojiHost";

export function sourceAllowsEmojiCandidate(state: EditorState, candidate: EmojiCandidate): boolean {
  // Use the editor's incremental parse. In an unparsed region, fail closed
  // rather than synchronously parsing an arbitrarily large note while typing.
  if (!state.facet(language) || !syntaxTreeAvailable(state, candidate.to)) return false;
  let blockStart = state.doc.lineAt(candidate.from).from;
  for (let node = syntaxTree(state).resolveInner(candidate.from, 1); node; node = node.parent!) {
    if (/^(?:InlineCode|FencedCode|CodeBlock|IndentedCode|HTMLBlock|HTMLTag|LinkReference|URL|LinkTitle)$/.test(node.name)) return false;
    if (/^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) blockStart = node.from;
  }
  if (candidate.from - blockStart > 4096) return false;
  const prefix = state.sliceDoc(blockStart, candidate.from);
  let delimiter = "";
  for (let offset = 0; offset < prefix.length; offset++) {
    if (prefix[offset] === "\\") { offset++; continue; }
    if (prefix[offset] !== "`") continue;
    let end = offset + 1;
    while (prefix[end] === "`") end++;
    const run = prefix.slice(offset, end);
    offset = end - 1;
    if (!delimiter) delimiter = run;
    else if (run === delimiter) delimiter = "";
  }
  return !delimiter;
}

export function createEmojiSourceHistoryExtension(beforeChange: (history: boolean) => void): Extension {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      if (update.docChanged) {
        beforeChange(update.transactions.some((transaction) =>
          transaction.isUserEvent("undo") || transaction.isUserEvent("redo"),
        ));
      }
    }
  });
}

export function createEmojiSourceExtension(binding: () => EmojiEditorBinding | undefined): Extension {
  return [
    Prec.highest(EditorView.domEventHandlers({
      keydown(event) {
        const host = binding()?.host;
        return host?.getSnapshot().suggestion ? host.key(event) : false;
      },
      compositionstart() { binding()?.host.close(false); },
      paste() { binding()?.host.close(false); },
      blur() {
        const host = binding()?.host;
        if (host?.getSnapshot().suggestion) host.close(false);
      },
    })),
    ViewPlugin.fromClass(class {
      private unregister: (() => void) | undefined;
      private live = true;
      private candidateActive = false;
      readonly adapter: EmojiEditorAdapter;

      constructor(readonly view: EditorView) {
        this.adapter = {
          scope: binding()?.scope ?? "",
          element: () => view.contentDOM,
          capture: (candidate) => this.capture(candidate),
        };
        this.unregister = binding()?.host.register(this.adapter);
        if (view.hasFocus) binding()?.host.activate(this.adapter);
      }
      private capture(candidate?: EmojiCandidate): EmojiBookmark | null {
        const current = binding();
        if (!current || !current.host.allowed(current.scope) || this.view.composing || this.view.state.readOnly) return null;
        const { doc, selection } = this.view.state;
        if (selection.ranges.length !== 1) return null;
        const from = candidate?.from ?? selection.main.from;
        const to = candidate?.to ?? selection.main.to;
        const valid = () => this.live && this.view.dom.isConnected && binding()?.scope === current.scope &&
          current.host.allowed(current.scope) && !this.view.state.readOnly && !this.view.composing &&
          this.view.state.doc === doc && this.view.state.selection.eq(selection);
        return {
          valid,
          restore: () => { if (valid()) this.view.focus(); },
          insert: (unicode) => {
            if (!valid()) return false;
            if (current.prepareSource && !current.prepareSource(doc.toString(), from, to, unicode)) return false;
            this.view.dispatch({
              changes: { from, to, insert: unicode },
              selection: { anchor: from + unicode.length },
              annotations: [Transaction.userEvent.of("input.emoji"), isolateHistory.of("full")],
              scrollIntoView: true,
            });
            this.view.focus();
            queueMicrotask(() => { if (this.live) this.view.focus(); });
            return true;
          },
        };
      }
      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        const current = binding();
        if (!current) return;
        const state = current.host.getSnapshot();
        if (state.picker || state.suggestion) current.host.reconcile();
        const clearCandidate = () => {
          if (this.candidateActive || current.host.getSnapshot().suggestion?.adapter === this.adapter) {
            this.candidateActive = false;
            current.host.suggest(this.adapter, null);
          }
        };
        const typed = update.transactions.some((transaction) => transaction.isUserEvent("input.type") &&
          !transaction.isUserEvent("input.type.compose"));
        if (update.view.composing || !typed || !update.state.selection.main.empty) {
          clearCandidate();
          return;
        }
        const head = update.state.selection.main.head;
        const start = Math.max(0, head - MAX_EMOJI_SHORTCODE_LENGTH - 2);
        const nearby = update.state.sliceDoc(start, head);
        const localCandidate = emojiCandidate(nearby, nearby.length);
        const candidate = localCandidate ? {
          ...localCandidate,
          from: start + localCandidate.from,
          to: head,
        } : null;
        if (!candidate || !update.view.hasFocus || !current.host.allowed(current.scope) || !sourceAllowsEmojiCandidate(update.state, candidate)) {
          clearCandidate();
          return;
        }
        this.candidateActive = true;
        current.host.suggest(this.adapter, candidate);
      }
      destroy() {
        this.live = false;
        this.unregister?.();
      }
    }, {
      eventHandlers: {
        focus() { binding()?.host.activate(this.adapter); },
      },
    }),
  ];
}
