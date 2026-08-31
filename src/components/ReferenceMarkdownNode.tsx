import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  type LexicalExportVisitor,
  type MdastImportVisitor,
  realmPlugin,
} from "@mdxeditor/editor";
import {
  LinkNode,
  type LinkAttributes,
  type SerializedLinkNode,
} from "@lexical/link";
import {
  $applyNodeReplacement,
  $createTextNode,
  $isElementNode,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import type {
  Definition,
  Html,
  Link,
  LinkReference,
  ReferenceType,
} from "mdast";
import type { RefObject } from "react";
import { isBlockedExternalScheme } from "../lib/links";
import {
  rawDefinitionGroupSource,
  rawReferenceSource,
  referenceDefinitionFor,
  referenceTypeAfterTextEdit,
  type ReferenceMarkdownSnapshot,
} from "../lib/referenceMarkdown";

type SerializedReferenceLinkNode = Omit<
  SerializedLinkNode,
  "type" | "version"
> & {
  type: "reference-link";
  version: 1;
  identifier: string;
  label: string | null;
  referenceType: ReferenceType;
  resolvedUrl: string;
  resolvedTitle: string | null;
};

interface SerializedReferenceDefinitionNode extends SerializedLexicalNode {
  type: "reference-definition";
  version: 1;
  raw: string;
}

export class ReferenceLinkNode extends LinkNode {
  __identifier: string;
  __label: string | null;
  __referenceType: ReferenceType;
  __resolvedUrl: string;
  __resolvedTitle: string | null;

  static getType(): string {
    return "reference-link";
  }

  static clone(node: ReferenceLinkNode): ReferenceLinkNode {
    return new ReferenceLinkNode(
      node.__url,
      {
        identifier: node.__identifier,
        label: node.__label,
        referenceType: node.__referenceType,
        resolvedUrl: node.__resolvedUrl,
        resolvedTitle: node.__resolvedTitle,
      },
      { title: node.__title },
      node.__key,
    );
  }

  static importJSON(
    serializedNode: SerializedLexicalNode & Record<string, unknown>,
  ) {
    const serialized = serializedNode as unknown as SerializedReferenceLinkNode;
    return $createReferenceLinkNode(serialized.url, {
      identifier: serialized.identifier,
      label: serialized.label,
      referenceType: serialized.referenceType,
      resolvedUrl: serialized.resolvedUrl,
      resolvedTitle: serialized.resolvedTitle,
    }, { title: serialized.title ?? null });
  }

  constructor(
    url: string,
    reference: {
      identifier: string;
      label: string | null;
      referenceType: ReferenceType;
      resolvedUrl: string;
      resolvedTitle: string | null;
    },
    attributes: LinkAttributes = {},
    key?: NodeKey,
  ) {
    super(url, attributes, key);
    this.__identifier = reference.identifier;
    this.__label = reference.label;
    this.__referenceType = reference.referenceType;
    this.__resolvedUrl = reference.resolvedUrl;
    this.__resolvedTitle = reference.resolvedTitle;
  }

  exportJSON(): SerializedLinkNode {
    return {
      ...super.exportJSON(),
      type: "reference-link",
      version: 1,
      identifier: this.__identifier,
      label: this.__label,
      referenceType: this.__referenceType,
      resolvedUrl: this.__resolvedUrl,
      resolvedTitle: this.__resolvedTitle,
    } as unknown as SerializedLinkNode;
  }

  getReferenceData() {
    return {
      identifier: this.__identifier,
      label: this.__label,
      referenceType: this.__referenceType,
      resolvedUrl: this.__resolvedUrl,
      resolvedTitle: this.__resolvedTitle,
    };
  }

  sanitizeUrl(url: string): string {
    const sanitized = super.sanitizeUrl(url);
    return sanitized !== "about:blank" && !/^[a-z][a-z0-9+.-]*:/i.test(url)
      ? url
      : sanitized;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.dataset.denoteReferenceTarget = interceptedReferenceTarget(this.__url);
    return element;
  }

  updateDOM(
    prevNode: this,
    anchor: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const replace = super.updateDOM(prevNode, anchor, config);
    if (prevNode.__url !== this.__url) {
      anchor.dataset.denoteReferenceTarget = interceptedReferenceTarget(this.__url);
    }
    return replace;
  }

}

function interceptedReferenceTarget(url: string): string {
  return isBlockedExternalScheme(url) || /[\u0000-\u001f\u007f]/.test(url)
    ? "about:blank"
    : url;
}

export class ReferenceDefinitionNode extends DecoratorNode<null> {
  __raw: string;

  static getType(): string {
    return "reference-definition";
  }

  static clone(node: ReferenceDefinitionNode): ReferenceDefinitionNode {
    return new ReferenceDefinitionNode(node.__raw, node.__key);
  }

  static importJSON(
    serializedNode: SerializedLexicalNode & Record<string, unknown>,
  ) {
    if (typeof serializedNode.raw !== "string") {
      throw new Error("Serialized reference definition is missing its source.");
    }
    return $createReferenceDefinitionNode(serializedNode.raw);
  }

  constructor(raw: string, key?: NodeKey) {
    super(key);
    this.__raw = raw;
  }

  exportJSON(): SerializedReferenceDefinitionNode {
    return {
      type: "reference-definition",
      version: 1,
      raw: this.__raw,
    };
  }

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const element = document.createElement("span");
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    element.dataset.denoteReferenceDefinition = "";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): null {
    return null;
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): false {
    return false;
  }

  getRaw(): string {
    return this.__raw;
  }
}

function $createReferenceLinkNode(
  url: string,
  reference: {
    identifier: string;
    label: string | null;
    referenceType: ReferenceType;
    resolvedUrl: string;
    resolvedTitle: string | null;
  },
  attributes: LinkAttributes = {},
): ReferenceLinkNode {
  return $applyNodeReplacement(
    new ReferenceLinkNode(url, reference, attributes),
  );
}

function $createReferenceDefinitionNode(
  raw: string,
): ReferenceDefinitionNode {
  return $applyNodeReplacement(new ReferenceDefinitionNode(raw));
}

function $isReferenceLinkNode(
  node: LexicalNode | null | undefined,
): node is ReferenceLinkNode {
  return node instanceof ReferenceLinkNode;
}

function $isReferenceDefinitionNode(
  node: LexicalNode | null | undefined,
): node is ReferenceDefinitionNode {
  return node instanceof ReferenceDefinitionNode;
}

export const referenceMarkdownPlugin = realmPlugin<{
  snapshot: RefObject<ReferenceMarkdownSnapshot>;
}>({
  init(realm, params) {
    const snapshot = () => params!.snapshot.current;
    const linkReferenceImportVisitor: MdastImportVisitor<LinkReference> = {
      testNode: "linkReference",
      visitNode({ mdastNode, lexicalParent, actions }) {
        const current = snapshot();
        const definition = referenceDefinitionFor(current, mdastNode);
        if (!definition?.resolvedUrl) {
          const text = $createTextNode(rawReferenceSource(current, mdastNode));
          text.setFormat(actions.getParentFormatting());
          const style = actions.getParentStyle();
          if (style) {
            text.setStyle(style);
          }
          if (!$isElementNode(lexicalParent)) {
            throw new Error("Reference text must be imported into an element.");
          }
          lexicalParent.append(text);
          return;
        }
        actions.addAndStepInto(
          $createReferenceLinkNode(
            definition.resolvedUrl,
            {
              identifier: mdastNode.identifier,
              label: mdastNode.label ?? null,
              referenceType: mdastNode.referenceType,
              resolvedUrl: definition.resolvedUrl,
              resolvedTitle: definition.title,
            },
            { title: definition.title },
          ),
        );
      },
      priority: 400,
    };
    const definitionImportVisitor: MdastImportVisitor<Definition> = {
      testNode: "definition",
      visitNode({ mdastNode, lexicalParent }) {
        if (!$isElementNode(lexicalParent)) {
          throw new Error("Reference definition must be imported at block level.");
        }
        const raw = rawDefinitionGroupSource(snapshot(), mdastNode);
        if (raw !== null) {
          lexicalParent.append($createReferenceDefinitionNode(raw));
        }
      },
      priority: 400,
    };
    const linkReferenceExportVisitor: LexicalExportVisitor<
      ReferenceLinkNode,
      LinkReference | Link
    > = {
      testLexicalNode: $isReferenceLinkNode,
      visitLexicalNode({ lexicalNode, actions }) {
        const reference = lexicalNode.getReferenceData();
        if (
          lexicalNode.getURL() === reference.resolvedUrl &&
          lexicalNode.getTitle() === reference.resolvedTitle
        ) {
          const referenceType = referenceTypeAfterTextEdit(
            reference.referenceType,
            reference.label,
            reference.identifier,
            lexicalNode.getTextContent(),
          );
          actions.addAndStepInto("linkReference", {
            identifier: reference.identifier,
            label: reference.label,
            referenceType,
          });
          return;
        }
        actions.addAndStepInto("link", {
          url: lexicalNode.getURL(),
          title: lexicalNode.getTitle(),
        });
      },
      priority: 400,
    };
    const definitionExportVisitor: LexicalExportVisitor<
      ReferenceDefinitionNode,
      Html
    > = {
      testLexicalNode: $isReferenceDefinitionNode,
      visitLexicalNode({ lexicalNode, mdastParent, actions }) {
        actions.appendToParent(mdastParent, {
          type: "html",
          value: lexicalNode.getRaw(),
        });
      },
      priority: 400,
    };

    realm.pub(addLexicalNode$, [
      ReferenceLinkNode,
      ReferenceDefinitionNode,
    ]);
    realm.pub(addImportVisitor$, [
      linkReferenceImportVisitor,
      definitionImportVisitor,
    ]);
    realm.pub(addExportVisitor$, [
      linkReferenceExportVisitor,
      definitionExportVisitor,
    ]);
  },
});
