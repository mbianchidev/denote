import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { addComposerChild$, addNestedEditorChild$, addTableCellEditorChild$, createRootEditorSubscription$, realmPlugin } from "@mdxeditor/editor";
import {
  $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
  COMMAND_PRIORITY_CRITICAL, HISTORY_PUSH_TAG, KEY_DOWN_COMMAND, PASTE_COMMAND,
  HISTORIC_TAG, RootNode, TextNode, mergeRegister,
  type RangeSelection,
} from "lexical";
import { createContext, useContext, useEffect } from "react";
import { emojiCandidate, emojiSelectionPatch, emojiSourceProjection, type EmojiCandidate, type EmojiSourceSnapshot } from "./emoji";
import type { EmojiBookmark, EmojiEditorAdapter, EmojiEditorBinding } from "./emojiHost";

export interface EmojiRichBinding extends EmojiEditorBinding {
  source(): string;
  sourceSnapshot?(): EmojiSourceSnapshot;
  prepare(source: string): void;
}
export const EmojiRichContext = createContext<EmojiRichBinding | undefined>(undefined);

function EmojiRichBridge() {
  const binding = useContext(EmojiRichContext);
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!binding) return;
    let live = true;
    let revision = 0;
    let selection: RangeSelection | null = null;
    let suppressInput = false;
    let composing = false;
    let typedInput = false;
    let focused = false;
    let candidateActive = false;
    const host = binding.host;
    const rememberSelection = () => {
      const next = $getSelection();
      if ($isRangeSelection(next)) {
        if (selection && (
          selection.anchor.key !== next.anchor.key || selection.anchor.offset !== next.anchor.offset ||
          selection.focus.key !== next.focus.key || selection.focus.offset !== next.focus.offset
        )) revision++;
        selection = next;
      }
    };
    const capture = (candidate?: EmojiCandidate): EmojiBookmark | null => {
      if (!selection) editor.getEditorState().read(() => {
        const root = $getRoot();
        const first = root.getFirstDescendant();
        selection = $createRangeSelection();
        if ($isTextNode(first)) {
          selection.anchor.set(first.getKey(), 0, "text");
          selection.focus.set(first.getKey(), 0, "text");
          selection.format = first.getFormat();
        } else {
          selection.anchor.set(root.getKey(), 0, "element");
          selection.focus.set(root.getKey(), 0, "element");
        }
      });
      if (!selection || !editor.isEditable() || editor.isComposing() || composing || !host.allowed(binding.scope)) return null;
      const saved = selection.clone();
      const capturedRevision = revision;
      const source = binding.source();
      const valid = () => live && !!editor.getRootElement()?.isConnected &&
        editor.getRootElement()?.closest<HTMLElement>(".mdxeditor-rich-text-editor")?.style.display !== "none" &&
        revision === capturedRevision && source === binding.source() &&
        editor.isEditable() && !editor.isComposing() && !composing && host.allowed(binding.scope);
      return {
        valid,
        restore() {
          if (!valid()) return;
          editor.getRootElement()?.focus();
          editor.update(() => { $setSelection(saved.clone()); }, { discrete: true, tag: "emoji-restore" });
        },
        insert(unicode) {
          if (!valid()) return false;
          let inserted = false;
          editor.update(() => {
            const range = saved.clone();
            if (candidate) {
              if (range.anchor.key !== range.focus.key || range.anchor.type !== "text") return;
              range.anchor.offset = candidate.from;
              range.focus.offset = candidate.to;
            }
            const patch = sourcePatch(source, range, unicode, binding.sourceSnapshot?.());
            if (patch === null) return;
            binding.prepare(patch);
            $setSelection(range);
            range.insertText(unicode);
            inserted = true;
          }, { discrete: true, tag: HISTORY_PUSH_TAG });
          if (inserted) {
            const insertedSource = binding.source();
            const insertedSelection = editor.getEditorState().read(() => {
              const next = $getSelection();
              return $isRangeSelection(next) ? next.clone() : null;
            });
            queueMicrotask(() => {
              if (!live || !host.allowed(binding.scope) || binding.source() !== insertedSource) return;
              const root = editor.getRootElement();
              if (!root?.isConnected || !editor.isEditable() || editor.isComposing() ||
                  root.closest<HTMLElement>(".mdxeditor-rich-text-editor")?.style.display === "none") return;
              root.focus();
              if (insertedSelection) {
                editor.update(() => { $setSelection(insertedSelection.clone()); }, { discrete: true, tag: "emoji-restore" });
              }
            });
          }
          return inserted;
        },
      };
    };
    const adapter: EmojiEditorAdapter = { scope: binding.scope, element: () => editor.getRootElement(), capture };
    const unregister = host.register(adapter);
    const clearCandidate = () => {
      if (candidateActive || host.getSnapshot().suggestion?.adapter === adapter) {
        candidateActive = false;
        host.suggest(adapter, null);
      }
    };
    const removeUpdate = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      const changed = dirtyElements.size > 0 || dirtyLeaves.size > 0;
      const typed = typedInput;
      typedInput = false;
      if (changed) revision++;
      editorState.read(() => {
        rememberSelection();
        const state = host.getSnapshot();
        if (state.picker || state.suggestion) host.reconcile();
        if (!focused || !changed || !typed || tags.has(HISTORY_PUSH_TAG) || tags.has("historic") ||
            suppressInput || composing || editor.isComposing()) {
          if (changed || !focused) clearCandidate();
          suppressInput = false;
          return;
        }
        const range = $getSelection();
        if (!$isRangeSelection(range) || !range.isCollapsed() || range.anchor.type !== "text") {
          clearCandidate();
          return;
        }
        const node = range.anchor.getNode();
        const candidate = $isTextNode(node) && !node.hasFormat("code")
          ? emojiCandidate(node.getTextContent(), range.anchor.offset) : null;
        if (!candidate) {
          clearCandidate();
          return;
        }
        const previousText = candidate.from === 0 ? node.getPreviousSibling()?.getTextContent() ?? "" : "";
        if ((previousText && !/[\s([{]$/.test(previousText)) || !host.allowed(binding.scope)) {
          clearCandidate();
          return;
        }
        candidateActive = true;
        host.suggest(adapter, candidate);
      });
    });
    const removeKeys = editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
      typedInput = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing;
      return host.getSnapshot().suggestion ? host.key(event) : false;
    }, COMMAND_PRIORITY_CRITICAL);
    const removePaste = editor.registerCommand(PASTE_COMMAND, () => {
      suppressInput = true;
      host.close(false);
      return false;
    }, COMMAND_PRIORITY_CRITICAL);
    const focus = () => {
      if (!focused) {
        focused = true;
        editor.getEditorState().read(rememberSelection);
        host.activate(adapter);
      }
    };
    const compositionStart = () => { composing = true; typedInput = false; host.close(false); };
    const compositionEnd = () => { composing = false; suppressInput = true; };
    const blur = () => {
      focused = false;
      if (host.getSnapshot().suggestion) host.close(false);
    };
    const beforeInput = (event: InputEvent) => { typedInput = event.inputType === "insertText" && !event.isComposing; };
    const rootCleanup = editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("focus", focus);
      previous?.removeEventListener("compositionstart", compositionStart);
      previous?.removeEventListener("compositionend", compositionEnd);
      previous?.removeEventListener("blur", blur);
      previous?.removeEventListener("beforeinput", beforeInput);
      root?.addEventListener("focus", focus);
      root?.addEventListener("compositionstart", compositionStart);
      root?.addEventListener("compositionend", compositionEnd);
      root?.addEventListener("blur", blur);
      root?.addEventListener("beforeinput", beforeInput);
      focused = false;
      if (root === document.activeElement) focus();
    });
    return () => {
      live = false;
      rootCleanup();
      const root = editor.getRootElement();
      root?.removeEventListener("focus", focus);
      root?.removeEventListener("compositionstart", compositionStart);
      root?.removeEventListener("compositionend", compositionEnd);
      root?.removeEventListener("blur", blur);
      root?.removeEventListener("beforeinput", beforeInput);
      removeUpdate(); removeKeys(); removePaste(); unregister();
    };
  }, [binding, editor]);
  return null;
}

function sourcePatch(source: string, selection: RangeSelection, unicode: string, snapshot?: EmojiSourceSnapshot): string | null {
  const projection = emojiSourceProjection(source, snapshot);
  const positions = new Map<string, { start: number; length: number }>();
  const nodes = $getRoot().getAllTextNodes().filter((node) => node.getTextContent() !== "");
  let cursor = 0;
  for (const node of nodes) {
    const text = node.getTextContent();
    if (!text) continue;
    const start = projection.text.indexOf(text, cursor);
    if (start < 0) return null;
    positions.set(node.getKey(), { start, length: text.length });
    cursor = start + text.length;
  }
  cursor = projection.text.length;
  for (const node of [...nodes].reverse()) {
    const text = node.getTextContent();
    const start = projection.text.lastIndexOf(text, cursor - text.length);
    const mapped = positions.get(node.getKey())!;
    if (start < 0) return null;
    if (start !== mapped.start && (node.getKey() === selection.anchor.key || node.getKey() === selection.focus.key)) return null;
    cursor = start;
  }
  if (selection.isCollapsed() && selection.anchor.type === "element") {
    const paragraph = selection.anchor.getNode();
    const root = $getRoot();
    if (paragraph.getType() === "paragraph" && paragraph.getTextContent() === "" &&
        paragraph.getParent()?.is(root)) {
      const blocks = projection.root.children;
      if (blocks.length === 0) return source + unicode;
      const firstBlockStart = blocks[0].position?.start.offset;
      const lastBlockEnd = blocks[blocks.length - 1].position?.end.offset;
      if (firstBlockStart === undefined || lastBlockEnd === undefined) return null;
      const siblingPoint = (after: boolean) => {
        const sibling = after ? paragraph.getPreviousSibling() : paragraph.getNextSibling();
        if (!$isElementNode(sibling)) return null;
        const textNodes = sibling.getAllTextNodes();
        const node = after ? textNodes[textNodes.length - 1] : textNodes[0];
        const mapped = node && positions.get(node.getKey());
        if (!mapped) return null;
        const projected = after ? mapped.start + mapped.length : mapped.start;
        const offset = after ? projection.ends[projected - 1] : projection.offsets[projected];
        const block = blocks.find((block) => {
          const start = block.position?.start.offset;
          const end = block.position?.end.offset;
          return start !== undefined && end !== undefined && start <= offset && end >= offset;
        });
        const sourceOffset = after ? block?.position?.end.offset : block?.position?.start.offset;
        return sourceOffset === undefined ? null : { after, projected, offset: sourceOffset };
      };
      const point = !paragraph.getNextSibling()
        ? { after: true, projected: projection.text.length, offset: lastBlockEnd }
        : !paragraph.getPreviousSibling()
          ? { after: false, projected: 0, offset: firstBlockStart }
          : siblingPoint(false) ?? siblingPoint(true);
      if (!point || point.offset < 0) return null;
      const newline = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
      const separator = newline.repeat(2);
      let offset = point.offset;
      let insertion = point.after ? separator + unicode : unicode + separator;
      // A newly created empty paragraph can already have source separators.
      if (point.after && source.slice(offset).startsWith(
        paragraph.getNextSibling() ? separator.repeat(2) : separator,
      )) {
        offset += separator.length;
        insertion = unicode;
      } else if (!point.after && source.slice(0, offset).endsWith(
        paragraph.getPreviousSibling() ? separator.repeat(2) : separator,
      )) {
        offset -= separator.length;
        insertion = unicode;
      }
      const patched = source.slice(0, offset) + insertion + source.slice(offset);
      const expected = projection.text.slice(0, point.projected) + unicode + projection.text.slice(point.projected);
      return emojiSourceProjection(patched).text === expected ? patched : null;
    }
  }
  const point = (position: RangeSelection["anchor"]) => {
    if (position.type !== "text") {
      const node = position.getNode();
      if (node.getTextContent() === "" && projection.text === "") return 0;
      return null;
    }
    const mapped = positions.get(position.key);
    if (!mapped) return null;
    if (position.offset === mapped.length) {
      const last = projection.ends[mapped.start + mapped.length - 1];
      return last >= 0 ? last : null;
    }
    const offset = projection.offsets[mapped.start + position.offset];
    return offset >= 0 ? offset : null;
  };
  const anchor = point(selection.anchor);
  const focus = point(selection.focus);
  if (anchor === null || focus === null) return null;
  const from = Math.min(anchor, focus);
  const to = Math.max(anchor, focus);
  const patched = emojiSelectionPatch(source, from, to, unicode, projection.root);
  const projectedPoint = (point: RangeSelection["anchor"]) =>
    point.type === "text" ? (positions.get(point.key)?.start ?? 0) + point.offset : 0;
  const projectedAnchor = projectedPoint(selection.anchor);
  const projectedFocus = projectedPoint(selection.focus);
  const expected = projection.text.slice(0, Math.min(projectedAnchor, projectedFocus)) + unicode +
    projection.text.slice(Math.max(projectedAnchor, projectedFocus));
  return emojiSourceProjection(patched).text === expected ? patched : null;
}

export const emojiRichPlugin = realmPlugin<{ beforeChange: (history: boolean) => void }>({
  init(realm, params) {
    // Mutation listeners run before MDXEditor's update-listener source export.
    realm.pub(createRootEditorSubscription$, (editor) => mergeRegister(
      editor.registerMutationListener(TextNode, (_nodes, { updateTags }) =>
        params?.beforeChange(updateTags.has(HISTORIC_TAG)), { skipInitialization: true }),
      editor.registerMutationListener(RootNode, (_nodes, { updateTags }) =>
        params?.beforeChange(updateTags.has(HISTORIC_TAG)), { skipInitialization: true }),
    ));
    realm.pubIn({
      [addComposerChild$]: EmojiRichBridge,
      [addNestedEditorChild$]: EmojiRichBridge,
      [addTableCellEditorChild$]: EmojiRichBridge,
    });
  },
});
