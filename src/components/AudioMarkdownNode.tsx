import { addExportVisitor$, addImportVisitor$, addLexicalNode$, realmPlugin, type LexicalExportVisitor, type MdastImportVisitor } from "@mdxeditor/editor";
import { $applyNodeReplacement, $isElementNode, DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode } from "lexical";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Html, Link, Nodes } from "mdast";
import { createContext, useContext, type ReactNode } from "react";
import { localAudioLink, type SpeechAudioBinding } from "../lib/speech";
import { AudioPlayback } from "./AudioPlayback";
import "./SensitiveTools.css";

export const AudioRenderContext = createContext<SpeechAudioBinding | undefined>(undefined);

function label(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return node.children.map(label).join("");
  return "";
}

interface SerializedAudioLink extends SerializedLexicalNode { type: "denote-audio-link"; version: 1; raw: string; href: string; label: string }

export class AudioLinkNode extends DecoratorNode<ReactNode> {
  constructor(private __raw: string, private __href: string, private __label: string, key?: NodeKey) { super(key); }
  static getType() { return "denote-audio-link"; }
  static clone(node: AudioLinkNode) { return new AudioLinkNode(node.__raw, node.__href, node.__label, node.__key); }
  static importJSON(node: SerializedLexicalNode & Record<string, unknown>) {
    if (typeof node.raw !== "string" || typeof node.href !== "string" || !localAudioLink(node.href) ||
        typeof node.label !== "string" || node.raw.length > 65536) throw new Error("Invalid portable audio link.");
    const root = fromMarkdown(node.raw);
    const paragraph = root.children[0];
    const link = paragraph?.type === "paragraph" ? paragraph.children[0] : null;
    if (root.children.length !== 1 || paragraph?.type !== "paragraph" || paragraph.children.length !== 1 ||
        link?.type !== "link" || link.url !== node.href || label(link) !== node.label ||
        link.position?.start.offset !== 0 || link.position?.end.offset !== node.raw.length) {
      throw new Error("Serialized audio must contain exactly its ordinary local link.");
    }
    return $applyNodeReplacement(new AudioLinkNode(node.raw, node.href, node.label));
  }
  exportJSON(): SerializedAudioLink { return { type: "denote-audio-link", version: 1, raw: this.__raw, href: this.__href, label: this.__label }; }
  createDOM() { const element = document.createElement("span"); element.className = "denote-audio-link"; element.contentEditable = "false"; return element; }
  updateDOM() { return false; }
  isInline() { return true; }
  isKeyboardSelectable() { return true; }
  raw() { return this.__raw; }
  decorate() { return <AudioLink href={this.__href} label={this.__label} />; }
}

function AudioLink({ href, label }: { href: string; label: string }) {
  const binding = useContext(AudioRenderContext);
  return <span>
    <a href={href}>{label || href}</a>
    {binding ? <AudioPlayback label={label || href} load={() => binding.read(decodeURIComponent(href))}
      onExport={() => binding.export(decodeURIComponent(href))} /> : null}
  </span>;
}

const exporter: LexicalExportVisitor<AudioLinkNode, Html> = {
  testLexicalNode: (node: LexicalNode): node is AudioLinkNode => node instanceof AudioLinkNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) { actions.appendToParent(mdastParent, { type: "html", value: lexicalNode.raw() }); },
  priority: 400,
};

export const audioMarkdownPlugin = realmPlugin<{ source: () => string }>({
  init(realm, params) {
    if (!params) throw new Error("Audio rendering requires an original-source snapshot.");
    let original = "";
    let records: Array<{ href: string; title: string | null; label: string; raw: string }> = [];
    let cursor = 0;
    let previousOffset = -1;
    const visitor: MdastImportVisitor<Link> = {
      priority: 400,
      testNode: (node) => node.type === "link" && localAudioLink(node.url) && node.position?.start.offset !== undefined,
      visitNode({ mdastNode, lexicalParent }) {
        const source = params.source();
        const offset = mdastNode.position?.start.offset ?? 0;
        if (original !== source || offset <= previousOffset) {
          original = source; records = []; cursor = 0;
          const visit = (node: Nodes) => {
            if (node.type === "link" && localAudioLink(node.url)) {
              const from = node.position?.start.offset;
              const to = node.position?.end.offset;
              if (from !== undefined && to !== undefined) records.push({ href: node.url, title: node.title ?? null, label: label(node), raw: source.slice(from, to) });
            }
            if ("children" in node) node.children.forEach(visit);
          };
          // Mask metadata without moving original source offsets.
          const prose = /^---(?:\r\n|\n|\r)/.test(source)
            ? source.replace(/^---(?:\r\n|\n|\r)[\s\S]*?^---(?:\r\n|\n|\r|$)/m, (value) => value.replace(/[^\r\n]/g, " "))
            : source;
          visit(fromMarkdown(prose));
        }
        previousOffset = offset;
        const index = records.findIndex((record, index) => index >= cursor && record.href === mdastNode.url &&
          record.title === (mdastNode.title ?? null) && record.label === label(mdastNode));
        const record = records[index];
        if (!record || !$isElementNode(lexicalParent)) throw new Error("The audio link cannot be matched to its source. Use Source; nothing was changed.");
        cursor = index + 1;
        lexicalParent.append($applyNodeReplacement(new AudioLinkNode(record.raw, record.href, record.label)));
      },
    };
    realm.pub(addLexicalNode$, AudioLinkNode);
    realm.pub(addImportVisitor$, visitor);
    realm.pub(addExportVisitor$, exporter);
  },
});
