import {
  addExportVisitor$, addImportVisitor$, addToMarkdownExtension$, realmPlugin,
  type LexicalExportVisitor, type MdastImportVisitor,
} from "@mdxeditor/editor";
import { $getState, $isElementNode, $isTextNode, $setState, createState, type LexicalNode, type TextNode } from "lexical";
import type { Emphasis, ListItem, Nodes, Parent, Strong, Text } from "mdast";
import { defaultHandlers, type AttentionInfo, type Handle, type State } from "mdast-util-to-markdown";

declare module "mdast" {
  interface Data {
    denoteMarker?: "_" | "*";
    denoteBullet?: "-" | "+" | "*";
  }
}

const emphasisMarker = createState("denoteEmphasisMarker", { parse: (value) => value === "_" || value === "*" ? value : null });
const strongMarker = createState("denoteStrongMarker", { parse: (value) => value === "_" || value === "*" ? value : null });
const bulletMarker = createState("denoteBulletMarker", { parse: (value) => value === "-" || value === "+" || value === "*" ? value : null });

function addedChildren(parent: LexicalNode, previous: LexicalNode | null): LexicalNode[] {
  if (!$isElementNode(parent)) return [];
  const children: LexicalNode[] = [];
  for (let node = previous ? previous.getNextSibling() : parent.getFirstChild(); node; node = node.getNextSibling()) children.push(node);
  return children;
}

function attentionHandler(kind: "emphasis" | "strong"): Handle {
  const native = defaultHandlers[kind];
  const marker = (node: Nodes, state: State) => {
    const preference = node.data?.denoteMarker;
    return preference === "_" || preference === "*" ? preference : state.options[kind] ?? "*";
  };
  return Object.assign((...args: Parameters<Handle>) => native(...args), {
    ...native,
    attention(node: Nodes, state: State): AttentionInfo {
      const preferred = marker(node, state);
      return { construct: kind, markers: [preferred, preferred === "_" ? "*" : "_"], sizes: [kind === "emphasis" ? 1 : 2] };
    },
    peek(node: Nodes, _parent: unknown, state: State) { return marker(node, state); },
  });
}

function inheritedBullet(node: LexicalNode): "-" | "+" | "*" | null {
  const own = $getState(node, bulletMarker);
  if (own) return own;
  for (const direction of ["previous", "next"] as const) {
    let sibling = direction === "previous" ? node.getPreviousSibling() : node.getNextSibling();
    while (sibling) {
      const marker = $getState(sibling, bulletMarker);
      if (marker) return marker;
      sibling = direction === "previous" ? sibling.getPreviousSibling() : sibling.getNextSibling();
    }
  }
  return null;
}

export function withOriginalListMarkers(state: State, render: () => string): string {
  // Delegate to the installed handler so GFM checkboxes retain their syntax.
  const native = state.handlers.listItem ?? defaultHandlers.listItem;
  state.handlers.listItem = Object.assign((...args: Parameters<Handle>) => {
    const [node, parent, current] = args;
    const previous = current.bulletCurrent;
    const marker = node.data?.denoteBullet;
    if (parent?.type === "list" && !parent.ordered && marker) current.bulletCurrent = marker;
    try { return native(...args); }
    finally { current.bulletCurrent = previous; }
  }, native);
  try { return render(); }
  finally { state.handlers.listItem = native; }
}

export const markdownSourceMarkersPlugin = realmPlugin<{ source: () => string }>({
  init(realm, params) {
    const inline: MdastImportVisitor<Emphasis | Strong> = {
      testNode: (node) => node.type === "emphasis" || node.type === "strong",
      priority: 50,
      visitNode({ mdastNode, lexicalParent, actions }) {
        const previous = $isElementNode(lexicalParent) ? lexicalParent.getLastChild() : null;
        actions.nextVisitor();
        const offset = mdastNode.position?.start.offset;
        const marker = offset === undefined ? undefined : params?.source()[offset];
        if ((marker !== "_" && marker !== "*") || !$isElementNode(lexicalParent)) return;
        for (const child of addedChildren(lexicalParent, previous)) {
          const texts = $isTextNode(child) ? [child] : $isElementNode(child) ? child.getAllTextNodes() : [];
          for (const node of texts) $setState(node, mdastNode.type === "emphasis" ? emphasisMarker : strongMarker, marker);
        }
      },
    };
    const item: MdastImportVisitor<ListItem> = {
      testNode: "listItem",
      priority: 50,
      visitNode({ mdastNode, lexicalParent, actions }) {
        const previous = $isElementNode(lexicalParent) ? lexicalParent.getLastChild() : null;
        actions.nextVisitor();
        const offset = mdastNode.position?.start.offset;
        const marker = offset === undefined ? undefined : params?.source()[offset];
        if ((marker !== "-" && marker !== "+" && marker !== "*") || !$isElementNode(lexicalParent)) return;
        const node = addedChildren(lexicalParent, previous).find((node) => node.getType() === "listitem");
        if (node) $setState(node, bulletMarker, marker);
      },
    };
    const text: LexicalExportVisitor<TextNode, Text> = {
      testLexicalNode: $isTextNode,
      priority: 50,
      visitLexicalNode({ lexicalNode, mdastParent, actions }) {
        if (!mdastParent) { actions.nextVisitor(); return; }
        const italic = $getState(lexicalNode, emphasisMarker);
        const bold = $getState(lexicalNode, strongMarker);
        let parent: Parent = mdastParent;
        let previous = parent.children[parent.children.length - 1];
        let separated: { parent: Parent; node: Emphasis | Strong; index: number } | null = null;
        while (previous && "children" in previous) {
          const marker = previous.type === "emphasis" ? italic : previous.type === "strong" ? bold : null;
          if (marker && previous.data?.denoteMarker && previous.data.denoteMarker !== marker &&
              (previous.type === "emphasis" || previous.type === "strong")) {
            separated = { parent, node: previous, index: parent.children.length - 1 };
            parent.children.pop();
            break;
          }
          parent = previous;
          previous = parent.children[parent.children.length - 1];
        }
        actions.nextVisitor();
        if (separated) separated.parent.children.splice(separated.index, 0, separated.node);
        let current = mdastParent.children[mdastParent.children.length - 1];
        while (current && "children" in current) {
          const marker = current.type === "emphasis" ? italic : current.type === "strong" ? bold : null;
          if (marker) current.data = { ...current.data, denoteMarker: marker };
          current = current.children[current.children.length - 1];
        }
      },
    };
    const list: LexicalExportVisitor<LexicalNode, ListItem> = {
      testLexicalNode: (node): node is LexicalNode => node.getType() === "listitem",
      priority: 50,
      visitLexicalNode({ lexicalNode, mdastParent, actions }) {
        actions.nextVisitor();
        const node = mdastParent?.children[mdastParent.children.length - 1];
        const marker = inheritedBullet(lexicalNode);
        if (node?.type === "listItem" && marker) node.data = { ...node.data, denoteBullet: marker };
      },
    };
    realm.pub(addImportVisitor$, [inline, item]);
    realm.pub(addExportVisitor$, [text, list]);
    realm.pub(addToMarkdownExtension$, { handlers: {
      emphasis: attentionHandler("emphasis"),
      strong: attentionHandler("strong"),
    } });
  },
});
