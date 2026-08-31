import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  type LexicalExportVisitor,
  type MdastImportVisitor,
  realmPlugin,
} from "@mdxeditor/editor";
import {
  $applyNodeReplacement,
  $isElementNode,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import type { Html } from "mdast";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, errorMessage } from "../lib/api";
import {
  parseSafeRichHtml,
  type SafeRichHtmlInline,
  type SafeRichHtmlModel,
} from "../lib/safeRichHtml";

interface SerializedSafeRichHtmlNode extends SerializedLexicalNode {
  type: "safe-rich-html";
  version: 1;
  raw: string;
}

interface SafeRichHtmlRenderContextValue {
  notePath: string;
  onError: (message: string) => void;
}

const SafeRichHtmlRenderContext =
  createContext<SafeRichHtmlRenderContextValue | null>(null);

export function SafeRichHtmlRenderProvider({
  notePath,
  onError,
  children,
}: SafeRichHtmlRenderContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ notePath, onError }), [notePath, onError]);
  return (
    <SafeRichHtmlRenderContext.Provider value={value}>
      {children}
    </SafeRichHtmlRenderContext.Provider>
  );
}

export class SafeRichHtmlNode extends DecoratorNode<ReactNode> {
  __raw: string;
  __model: SafeRichHtmlModel;

  static getType(): string {
    return "safe-rich-html";
  }

  static clone(node: SafeRichHtmlNode): SafeRichHtmlNode {
    return new SafeRichHtmlNode(
      node.__raw,
      structuredClone(node.__model),
      node.__key,
    );
  }

  static importJSON(
    serializedNode: SerializedLexicalNode & Record<string, unknown>,
  ) {
    if (typeof serializedNode.raw !== "string") {
      throw new Error("Serialized safe rich HTML is missing its raw source.");
    }
    const model = parseSafeRichHtml(serializedNode.raw);
    if (!model) {
      throw new Error("Serialized safe rich HTML is no longer valid.");
    }
    return $createSafeRichHtmlNode(serializedNode.raw, model);
  }

  constructor(raw: string, model: SafeRichHtmlModel, key?: NodeKey) {
    super(key);
    this.__raw = raw;
    this.__model = model;
  }

  exportJSON(): SerializedSafeRichHtmlNode {
    return {
      type: "safe-rich-html",
      version: 1,
      raw: this.__raw,
    };
  }

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const element = document.createElement("div");
    element.className = "safe-rich-html";
    element.dataset.denoteSafeRichHtml = "";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): ReactNode {
    return <SafeRichHtmlRenderer model={this.__model} />;
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  getRaw(): string {
    return this.__raw;
  }
}

export function $createSafeRichHtmlNode(
  raw: string,
  model: SafeRichHtmlModel,
): SafeRichHtmlNode {
  return $applyNodeReplacement(new SafeRichHtmlNode(raw, model));
}

export function $isSafeRichHtmlNode(
  node: LexicalNode | null | undefined,
): node is SafeRichHtmlNode {
  return node instanceof SafeRichHtmlNode;
}

const safeRichHtmlImportVisitor: MdastImportVisitor<Html> = {
  testNode(node) {
    return node.type === "html" && parseSafeRichHtml(node.value) !== null;
  },
  visitNode({ mdastNode, lexicalParent }) {
    const model = parseSafeRichHtml(mdastNode.value);
    if (!model || !$isElementNode(lexicalParent)) {
      throw new Error("Safe rich HTML visitor received invalid HTML.");
    }
    lexicalParent.append($createSafeRichHtmlNode(mdastNode.value, model));
  },
  priority: 300,
};

const safeRichHtmlExportVisitor: LexicalExportVisitor<
  SafeRichHtmlNode,
  Html
> = {
  testLexicalNode: $isSafeRichHtmlNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, {
      type: "html",
      value: lexicalNode.getRaw(),
    });
  },
  priority: 300,
};

export const safeRichHtmlPlugin = realmPlugin({
  init(realm) {
    realm.pub(addLexicalNode$, SafeRichHtmlNode);
    realm.pub(addImportVisitor$, safeRichHtmlImportVisitor);
    realm.pub(addExportVisitor$, safeRichHtmlExportVisitor);
  },
});

function SafeRichHtmlRenderer({ model }: { model: SafeRichHtmlModel }) {
  if (model.type === "image") {
    return <SafeRichHtmlImage image={model.image} />;
  }
  return createElement(
    model.tag,
    {
      className: "safe-rich-html__block",
      ...(model.align ? { style: { textAlign: model.align } } : {}),
    },
    renderChildren(model.children),
  );
}

function renderChildren(children: SafeRichHtmlInline[]): ReactNode[] {
  return children.map((child, index) => {
    const key = `${child.type}-${index}`;
    if (child.type === "text") {
      return child.value;
    }
    if (child.type === "strong") {
      return <strong key={key}>{renderChildren(child.children)}</strong>;
    }
    if (child.type === "link") {
      return (
        <a key={key} href={child.href} data-denote-safe-rich-html-link="">
          {renderChildren(child.children)}
        </a>
      );
    }
    return <SafeRichHtmlImage key={key} image={child} />;
  });
}

function SafeRichHtmlImage({
  image,
}: {
  image: Extract<SafeRichHtmlInline, { type: "image" }>;
}) {
  const context = useContext(SafeRichHtmlRenderContext);
  const [localSource, setLocalSource] = useState<string | null>(
    image.remote ? image.src : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.remote) {
      setLocalSource(image.src);
      setFailed(false);
      return;
    }
    let active = true;
    setLocalSource(null);
    setFailed(false);
    if (!context) {
      setFailed(true);
      return;
    }
    api
      .readImageDataUrl(image.src, context.notePath)
      .then((source) => {
        if (active) {
          setLocalSource(source);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setFailed(true);
          context.onError(errorMessage(caught));
        }
      });
    return () => {
      active = false;
    };
  }, [context, image.remote, image.src]);

  if (failed) {
    return (
      <span className="safe-rich-html__image-error" role="img" aria-label={image.alt}>
        Image unavailable: {image.alt || image.src}
      </span>
    );
  }
  if (!localSource) {
    return (
      <span className="safe-rich-html__image-loading" aria-live="polite">
        Loading image: {image.alt || image.src}
      </span>
    );
  }
  return (
    <img
      src={localSource}
      alt={image.alt}
      title={image.title}
      width={image.width}
      height={image.height}
      loading="lazy"
      referrerPolicy={image.remote ? "no-referrer" : undefined}
      draggable={false}
    />
  );
}
