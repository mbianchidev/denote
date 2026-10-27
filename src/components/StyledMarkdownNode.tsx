import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  addComposerChild$, addNestedEditorChild$, addTableCellEditorChild$,
  addExportVisitor$, addImportVisitor$, addLexicalNode$,
  type LexicalExportVisitor, type MdastImportVisitor, realmPlugin,
} from "@mdxeditor/editor";
import {
  $applyNodeReplacement, $createRangeSelection, $getNodeByKey, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, $setSelection,
  HISTORY_PUSH_TAG,
  TextNode, type EditorConfig, type NodeKey, type SerializedTextNode, type RangeSelection,
} from "lexical";
import type { Html, Parent, PhrasingContent, Root, Text } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { createContext, useContext, useEffect } from "react";
import { AUTHORING_COLORS, textStyleDelimiter, type PluginAuthoringColor, type PluginTextStyle } from "@denote/plugin-sdk";
import { textStyleVariables, type AuthoringEditorBinding } from "../lib/authoring";
import { richSourceSelection } from "../lib/richSourceSelection";
import { createMarkdownSourceMapper, emojiSourceProjection, type EmojiSourceSnapshot } from "../lib/emoji";

const STYLE_TOKEN = /=(yellow|red|green|blue|purple)(:text)?=([^\r\n]+?)=\1\2=/g;

export function styledLiteralRanges(line: string): Array<{ from: number; to: number }> {
  if (!line.includes("=")) return [];
  return [...line.matchAll(STYLE_TOKEN)].map((match) => ({ from: match.index, to: match.index + match[0].length }));
}

interface NativeHighlight extends Parent {
  type: "highlight";
  children: PhrasingContent[];
}
// MDXEditor emits this native extension without exporting its mdast type.
declare module "mdast" {
  interface PhrasingContentMap { highlight: NativeHighlight }
  interface RootContentMap { highlight: NativeHighlight }
}

export const AuthoringRichContext = createContext<{
  binding: AuthoringEditorBinding;
  source: () => string;
  snapshot: () => EmojiSourceSnapshot;
  prepare: (source: string) => void;
} | null>(null);

function AuthoringSelectionBridge() {
  const context = useContext(AuthoringRichContext);
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!context) return;
    let saved: RangeSelection | null = null;
    const remember = () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) saved = selection.clone();
    };
    const unregister = context.binding.registerSelection((allowCollapsed = false) => {
      const root = editor.getRootElement();
      if (!root?.isConnected || editor.isComposing() ||
          root.closest<HTMLElement>(".mdxeditor-rich-text-editor")?.style.display === "none") return null;
      return editor.getEditorState().read(() => {
        remember();
        if (!saved || saved.isCollapsed() && !allowCollapsed) return null;
        const source = context.source();
        const range = richSourceSelection(source, saved, context.snapshot());
        const captured = saved.clone();
        return range ? {
          source, ...range,
          restore: () => {
            if (!root.isConnected || context.source() !== source) return;
            root.focus();
            editor.update(() => $setSelection(captured.clone()), { discrete: true, tag: "authoring-restore" });
          },
          apply: (edit, next) => {
            if (context.source() !== source || !root.isConnected || !editor.isEditable() ||
                edit.from !== range.from || edit.to !== range.to) return false;
            const styleSnapshot = context.binding.styles();
            const span = styleSnapshot?.source === next ? styleSnapshot.spans.find((span) =>
              span.from === edit.from && span.to === edit.from + edit.text.length) : null;
            if (!span) return false;
            context.prepare(next);
            editor.update(() => {
              const selection = captured.clone();
              $setSelection(selection);
              const raw = next.slice(span.from, span.to);
              selection.insertNodes([$applyNodeReplacement(new StyledTextNode(
                decodedStyle(span), span.style, span.color, undefined, raw,
              )).setFormat(selection.format)]);
            }, { discrete: true, tag: HISTORY_PUSH_TAG });
            return true;
          },
        } : null;
      });
    });
    const unregisterEdit = context.binding.registerEdit((edit, next) => {
      const root = editor.getRootElement();
      if (!root?.isConnected || !editor.isEditable() || editor.isComposing() ||
          root.closest<HTMLElement>(".mdxeditor-rich-text-editor")?.style.display === "none") return false;
      const source = context.source();
      let key: string | null = null;
      editor.getEditorState().read(() => {
        for (const node of $getRoot().getAllTextNodes()) {
          if (!(node instanceof StyledTextNode) || node.__styleKind === "literal" ||
              node.raw() !== source.slice(edit.from, edit.to)) continue;
          const range = $createRangeSelection();
          range.anchor.set(node.getKey(), 0, "text");
          range.focus.set(node.getKey(), node.getTextContentSize(), "text");
          const mapped = richSourceSelection(source, range, context.snapshot());
          const delimiter = textStyleDelimiter(node.__styleKind, node.__paletteColor);
          if (mapped?.from === edit.from + delimiter.length && mapped.to === edit.to - delimiter.length) key = node.getKey();
        }
      });
      if (!key) return false;
      let applied = false;
      editor.update(() => {
        const node = $getNodeByKey(key!);
        if (!(node instanceof StyledTextNode)) return;
        context.prepare(next);
        node.replace($applyNodeReplacement(new StyledTextNode(
          node.getTextContent(), "literal", "yellow", undefined, edit.text,
        )).setFormat(node.getFormat()));
        applied = true;
      }, { discrete: true, tag: HISTORY_PUSH_TAG });
      return applied;
    });
    const removeUpdate = editor.registerUpdateListener(({ editorState }) => editorState.read(remember));
    return () => { unregister(); unregisterEdit(); removeUpdate(); };
  }, [context, editor]);
  return null;
}

interface SerializedStyledTextNode extends SerializedTextNode {
  styleKind: "highlight" | "color" | "literal";
  paletteColor: PluginAuthoringColor;
  originalRaw: string;
  originalText: string;
}

export class StyledTextNode extends TextNode {
  __styleKind: "highlight" | "color" | "literal";
  __paletteColor: PluginAuthoringColor;
  __originalRaw: string;
  __originalText: string;

  static getType() { return "denote-styled-text"; }
  static clone(node: StyledTextNode) {
    return new StyledTextNode(node.__text, node.__styleKind, node.__paletteColor, node.__key, node.__originalRaw, node.__originalText);
  }
  static importJSON(serialized: SerializedTextNode) {
    const kind = "styleKind" in serialized ? serialized.styleKind : null;
    const color = "paletteColor" in serialized ? AUTHORING_COLORS.find((color) => color === serialized.paletteColor) : null;
    if ((kind !== "highlight" && kind !== "color" && kind !== "literal") || !color) throw new Error("Invalid serialized text style.");
    const raw = "originalRaw" in serialized && typeof serialized.originalRaw === "string" ? serialized.originalRaw : undefined;
    const original = "originalText" in serialized && typeof serialized.originalText === "string" ? serialized.originalText : serialized.text;
    return $applyNodeReplacement(new StyledTextNode(serialized.text, kind, color, undefined, raw, original)).updateFromJSON(serialized);
  }
  constructor(text: string, kind: "highlight" | "color" | "literal", color: PluginAuthoringColor, key?: NodeKey, raw?: string, originalText = text) {
    super(text, key);
    this.__styleKind = kind;
    this.__paletteColor = color;
    this.__originalText = originalText;
    const delimiter = kind === "literal" ? "" : textStyleDelimiter(kind, color);
    this.__originalRaw = raw ?? delimiter + text + delimiter;
  }
  exportJSON(): SerializedStyledTextNode {
    return { ...super.exportJSON(), type: StyledTextNode.getType(), styleKind: this.__styleKind, paletteColor: this.__paletteColor,
      originalRaw: this.__originalRaw, originalText: this.__originalText };
  }
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    this.applyStyle(element);
    return element;
  }
  updateDOM(previous: this, element: HTMLElement, config: EditorConfig): boolean {
    const replace = super.updateDOM(previous, element, config);
    this.applyStyle(element);
    return replace;
  }
  private applyStyle(element: HTMLElement) {
    if (this.__styleKind === "literal") return;
    element.classList.add("denote-text-style");
    element.dataset.styleKind = this.__styleKind;
    element.dataset.styleColor = this.__paletteColor;
    element.title = `${this.__paletteColor} ${this.__styleKind === "highlight" ? "highlight" : "text color"}`;
    element.setAttribute("aria-label", `${element.title}: ${this.__text}`);
    for (const [key, value] of Object.entries(textStyleVariables(this.__paletteColor))) element.style.setProperty(key, String(value));
  }
  raw(): string {
    const text = this.getTextContent();
    if (text === this.__originalText) return this.__originalRaw;
    const literal = toMarkdown({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: `x${text}x` }] }] }).replace(/\n$/, "").slice(1, -1);
    if (this.__styleKind === "literal") return literal.replace(/=(yellow|red|green|blue|purple)(:text)?=/g, "\\=$1$2=");
    const delimiter = textStyleDelimiter(this.__styleKind, this.__paletteColor);
    return delimiter + literal + delimiter;
  }
}

function decodedStyle(span: PluginTextStyle): string {
  const delimiter = textStyleDelimiter(span.style, span.color);
  return emojiSourceProjection(delimiter + span.text + delimiter).text.slice(delimiter.length, -delimiter.length);
}

interface ImportedSegment {
  text: string;
  raw: string;
  kind: "highlight" | "color" | "literal";
  color: PluginAuthoringColor;
}

export const styledMarkdownPlugin = realmPlugin<{ binding: AuthoringEditorBinding; source: () => string }>({
  init(realm, params) {
    let cachedSnapshot: ReturnType<AuthoringEditorBinding["styles"]> = null;
    let cachedSource = "";
    let spans = new Map<number, PluginTextStyle>();
    let mapSource = createMarkdownSourceMapper("", "");
    let cache = new WeakMap<Text, ImportedSegment[]>();
    const segments = (node: Text): ImportedSegment[] => {
      const snapshot = params?.binding.styles();
      const source = params?.source() ?? "";
      if (!snapshot || !node.value.includes("=")) return [];
      if (cachedSnapshot !== snapshot || cachedSource !== source) {
        cachedSnapshot = snapshot; cachedSource = source;
        spans = new Map(snapshot.spans.map((span) => [span.from, span]));
        mapSource = createMarkdownSourceMapper(snapshot.source, source);
        cache = new WeakMap();
      }
      const known = cache.get(node);
      if (known) return known;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return [];
      const raw = source.slice(start, end);
      const candidates: Array<{ from: number; to: number; span?: PluginTextStyle }> = [];
      for (const match of raw.matchAll(STYLE_TOKEN)) {
        let escapes = 0;
        for (let index = match.index - 1; index >= 0 && raw[index] === "\\"; index--) escapes++;
        const from = match.index - (escapes % 2);
        const to = match.index + match[0].length;
        if (escapes % 2) { candidates.push({ from, to }); continue; }
        const mapped = mapSource(start + from, start + to);
        const span = mapped ? spans.get(mapped.from) : undefined;
        if (span && span.to === mapped!.to && snapshot.source.slice(span.from, span.to) === match[0]) candidates.push({ from, to, span });
      }
      if (!candidates.length) { cache.set(node, []); return []; }
      const lines = raw.split(/\r\n|\n|\r/);
      const tree: Root = { type: "root", children: [{ type: "paragraph", children: [{
        type: "text", value: node.value, position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: lines.length, column: lines[lines.length - 1].length + 1, offset: raw.length },
        },
      }] }] };
      const projected = emojiSourceProjection(raw, { source: raw, root: tree });
      if (projected.text !== node.value) return [];
      const result: ImportedSegment[] = [];
      let visible = 0;
      let previousVisible = 0;
      let previousRaw = 0;
      for (const candidate of candidates) {
        while (visible < projected.ends.length && projected.ends[visible] <= candidate.from) visible++;
        const first = visible;
        while (visible < projected.offsets.length && projected.offsets[visible] < candidate.to) visible++;
        if (first > previousVisible) result.push({ text: node.value.slice(previousVisible, first), raw: raw.slice(previousRaw, candidate.from), kind: "literal", color: "yellow" });
        const token = node.value.slice(first, visible);
        const span = candidate.span;
        const delimiter = span ? textStyleDelimiter(span.style, span.color) : "";
        result.push({
          text: span ? token.slice(delimiter.length, -delimiter.length) : token,
          raw: raw.slice(candidate.from, candidate.to), kind: span?.style ?? "literal", color: span?.color ?? "yellow",
        });
        previousVisible = visible; previousRaw = candidate.to;
      }
      if (previousVisible < node.value.length) result.push({ text: node.value.slice(previousVisible), raw: raw.slice(previousRaw), kind: "literal", color: "yellow" });
      cache.set(node, result);
      return result;
    };
    const importer: MdastImportVisitor<Text> = {
      testNode: (node) => node.type === "text" && segments(node).length > 0,
      visitNode({ mdastNode, lexicalParent, actions }) {
        if (!$isElementNode(lexicalParent)) throw new Error("Styled text requires a Markdown text parent.");
        for (const segment of segments(mdastNode)) {
          const node = $applyNodeReplacement(new StyledTextNode(segment.text, segment.kind, segment.color, undefined, segment.raw));
          node.setFormat(actions.getParentFormatting());
          node.setStyle(actions.getParentStyle());
          lexicalParent.append(node);
        }
      },
      priority: 500,
    };
    const exporter: LexicalExportVisitor<StyledTextNode, Html> = {
      testLexicalNode: (node): node is StyledTextNode => node instanceof StyledTextNode,
      visitLexicalNode({ lexicalNode, mdastParent, actions }) {
        const formats = [
          { flag: "underline", type: "mdxJsxTextElement", name: "u" },
          { flag: "superscript", type: "mdxJsxTextElement", name: "sup" },
          { flag: "subscript", type: "mdxJsxTextElement", name: "sub" },
          { flag: "italic", type: "emphasis", name: null },
          { flag: "bold", type: "strong", name: null },
          { flag: "strikethrough", type: "delete", name: null },
          { flag: "highlight", type: "highlight", name: null },
        ] as const;
        const remaining = new Set(formats.filter((format) => lexicalNode.hasFormat(format.flag)));
        let parent = mdastParent;
        const style = lexicalNode.getStyle();
        if (style) {
          const child = actions.appendToParent(parent, {
            type: "mdxJsxTextElement", name: "span", children: [],
            attributes: [{ type: "mdxJsxAttribute", name: "style", value: style }],
          });
          if (!("children" in child)) throw new Error("Markdown text styling requires a container.");
          parent = child;
        }
        // Continue native text-format containers across this raw-source leaf.
        while (remaining.size) {
          const child = parent.children[parent.children.length - 1];
          const format = [...remaining].find((format) => child?.type === format.type &&
            (!format.name || "name" in child && child.name === format.name &&
              "attributes" in child && Array.isArray(child.attributes) && child.attributes.length === 0));
          if (!format || !("children" in child)) break;
          parent = child;
          remaining.delete(format);
        }
        const run = (flag: (typeof formats)[number]["flag"]) => {
          let count = 0;
          for (let sibling = lexicalNode.getNextSibling(); $isTextNode(sibling) &&
              sibling.hasFormat(flag) && sibling.getStyle() === lexicalNode.getStyle(); sibling = sibling.getNextSibling()) count++;
          return count;
        };
        for (const format of [...remaining].sort((left, right) =>
          Number(right.name !== null) - Number(left.name !== null) || run(right.flag) - run(left.flag))) {
          const child = format.name
            ? actions.appendToParent(parent, { type: "mdxJsxTextElement", name: format.name, attributes: [], children: [] })
            : actions.appendToParent(parent, { type: format.type, children: [] });
          if (!("children" in child)) throw new Error("Markdown text formatting requires a container.");
          parent = child;
        }
        actions.appendToParent(parent, lexicalNode.hasFormat("code")
          ? { type: "inlineCode", value: lexicalNode.__styleKind === "literal" ? lexicalNode.getTextContent() : lexicalNode.raw() }
          : { type: "html", value: lexicalNode.raw() });
      },
      priority: 500,
    };
    realm.pub(addLexicalNode$, StyledTextNode);
    realm.pub(addImportVisitor$, importer);
    realm.pub(addExportVisitor$, exporter);
    realm.pubIn({
      [addComposerChild$]: AuthoringSelectionBridge,
      [addNestedEditorChild$]: AuthoringSelectionBridge,
      [addTableCellEditorChild$]: AuthoringSelectionBridge,
    });
  },
});
