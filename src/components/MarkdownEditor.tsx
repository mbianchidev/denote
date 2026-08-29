import {
  $isDirectiveNode,
  AdmonitionDirectiveDescriptor,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeAdmonitionType,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  DiffSourceToggleWrapper,
  HighlightToggle,
  InsertAdmonition,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  directivesPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  markdownProcessingError$,
  openLinkEditDialog$,
  quotePlugin,
  realmPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  viewMode$,
} from "@mdxeditor/editor";
import { usePublisher } from "@mdxeditor/gurx";
import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Link2 } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { api, errorMessage } from "../lib/api";
import { CODE_BLOCK_LANGUAGES } from "../lib/codeBlockLanguages";
import {
  createEditorDiagnosticExtensions,
  createEditorDisplayExtensions,
  createEditorTabExtensions,
  denoteCodeMirrorTheme,
  markdownLinkKeymap,
  setEditorDiagnostic,
} from "../lib/editorExtensions";
import {
  hasEditorDisplayGuides,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";
import { denoteHashtagPlugin } from "../lib/hashtagPlugin";
import { shouldOpenLinkOnClick } from "../lib/links";
import {
  locateMarkdownError,
  type MarkdownErrorLocation,
} from "../lib/markdownErrors";
import {
  calloutsToDirectives,
  applyTocMarkerViewChange,
  captureTocMarkers,
  captureMarkdownBoundaryWhitespace,
  directivesToCallouts,
  hasUnsupportedRichMarkdown,
  nextHeadingSlug,
  normalizeBareSpaceLinkDestinations,
  recoverMarkdownLinkTarget,
  restoreRichTextTagSyntax,
  restoreMarkdownBoundaryWhitespace,
} from "../lib/markdown";
import type { MarkdownViewMode } from "../lib/markdownView";
import {
  normalizeTag,
  resolveTagColor,
  tagColorStyle,
  type TagColorMap,
} from "../lib/tagColors";
import type { FileLineEnding } from "../types";

const viewModePreferencePlugin = realmPlugin<{
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
  onErrorCleared?: () => void;
  onModeChange?: (mode: MarkdownViewMode) => void;
}>({
  init(realm, params) {
    let ready = false;
    let forcingSource = false;
    let hadProcessingError = false;
    let previousMode = params?.mode ?? "rich-text";
    realm.sub(realm.pipe(viewMode$), (mode) => {
      if (mode !== "diff") {
        params?.onModeChange?.(mode);
      }
      if (!ready) {
        if (mode !== "diff") {
          previousMode = mode;
        }
        return;
      }
      if (mode !== "diff" && mode !== previousMode) {
        previousMode = mode;
        if (!forcingSource) {
          params?.onChange(mode);
        }
      }
    });
    realm.sub(realm.pipe(markdownProcessingError$), (error) => {
      if (!error) {
        if (hadProcessingError) {
          hadProcessingError = false;
          params?.onErrorCleared?.();
        }
        return;
      }
      hadProcessingError = true;
      forcingSource = true;
      realm.pub(viewMode$, "source");
      queueMicrotask(() => {
        forcingSource = false;
      });
    });
    queueMicrotask(() => {
      ready = true;
    });
  },
  postInit(realm, params) {
    realm.pub(
      viewMode$,
      realm.getValue(markdownProcessingError$)
        ? "source"
        : (params?.mode ?? "rich-text"),
    );
  },
});

interface MarkdownEditorProps {
  notePath: string;
  markdown: string;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  preferredViewMode: MarkdownViewMode;
  readOnly: boolean;
  errorLocation?: MarkdownErrorLocation;
  errorNavigationRequest?: number;
  tagColors?: TagColorMap;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onMarkdownError?: (diagnostic: MarkdownEditorDiagnostic) => void;
  onMarkdownErrorCleared?: () => void;
  onLinkOpen: (href: string, text: string) => void;
  onViewModeChange: (mode: MarkdownViewMode) => void;
  onImageUpload: (notePath: string, file: File) => Promise<string>;
}

export interface MarkdownEditorDiagnostic {
  message: string;
  source: string;
  location: MarkdownErrorLocation | null;
}

export const MarkdownEditor = forwardRef<
  MDXEditorMethods,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    notePath,
    markdown,
    lineEnding,
    displaySettings,
    preferredViewMode,
    readOnly,
    errorLocation,
    errorNavigationRequest = 0,
    tagColors = EMPTY_TAG_COLORS,
    onChange,
    onError,
    onMarkdownError,
    onMarkdownErrorCleared,
    onLinkOpen,
    onViewModeChange,
    onImageUpload,
  },
  ref,
) {
  const editorMarkdown = useMemo(
    () => normalizeBareSpaceLinkDestinations(markdown),
    [markdown],
  );
  const [sourceFirst] = useState(() => hasUnsupportedRichMarkdown(markdown));
  const shellRef = useRef<HTMLDivElement>(null);
  const initialPreferredViewMode = useRef(preferredViewMode).current;
  const onLinkOpenRef = useRef(onLinkOpen);
  onLinkOpenRef.current = onLinkOpen;
  const forceSource = hasEditorDisplayGuides(displaySettings);
  const initialViewMode: MarkdownViewMode =
    sourceFirst || forceSource ? "source" : initialPreferredViewMode;
  const activeViewModeRef = useRef<MarkdownViewMode>(initialViewMode);
  const [activeViewMode, setActiveViewMode] =
    useState<MarkdownViewMode>(initialViewMode);
  const displayExtensions = useMemo(
    () => [
      ...createEditorDisplayExtensions(displaySettings, lineEnding, false),
      ...createEditorDiagnosticExtensions(),
    ],
    [displaySettings, lineEnding],
  );
  const tabExtensions = useMemo(
    () => createEditorTabExtensions(displaySettings),
    [displaySettings],
  );
  const boundaryWhitespace = useRef(
    captureMarkdownBoundaryWhitespace(markdown),
  ).current;
  const tocMarkersRef = useRef<ReturnType<typeof captureTocMarkers> | null>(
    null,
  );
  if (tocMarkersRef.current === null) {
    tocMarkersRef.current = captureTocMarkers(markdown);
  }
  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      denoteHashtagPlugin(),
      markdownShortcutPlugin(),
      linkPlugin({ disableAutoLink: false }),
      linkDialogPlugin({
        showLinkTitleField: true,
        onClickLinkCallback: (url) => onLinkOpenRef.current(url, ""),
        onReadOnlyClickLinkCallback: (event, _node, url) => {
          event.preventDefault();
          event.stopPropagation();
          onLinkOpenRef.current(url, "");
        },
      }),
      imagePlugin({
        imageUploadHandler: (file) => onImageUpload(notePath, file),
        imagePreviewHandler: async (source) => {
          if (
            source.startsWith("data:") ||
            source.startsWith("http://") ||
            source.startsWith("https://")
          ) {
            return source;
          }
          return api.readImageDataUrl(source, notePath);
        },
        allowSetImageDimensions: true,
      }),
      tablePlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
      codeMirrorPlugin({
        codeMirrorExtensions: [denoteCodeMirrorTheme, ...tabExtensions],
        codeBlockLanguages: CODE_BLOCK_LANGUAGES,
        autoLoadLanguageSupport: true,
      }),
      frontmatterPlugin(),
      directivesPlugin({
        directiveDescriptors: [AdmonitionDirectiveDescriptor],
      }),
      diffSourcePlugin({
        viewMode: initialViewMode,
        diffMarkdown: "",
        readOnlyDiff: false,
        codeMirrorExtensions: [
          denoteCodeMirrorTheme,
          markdownLinkKeymap,
          ...displayExtensions,
        ],
      }),
      viewModePreferencePlugin({
        mode: initialViewMode,
        onChange: onViewModeChange,
        onErrorCleared: onMarkdownErrorCleared,
        onModeChange: (mode) => {
          activeViewModeRef.current = mode;
          setActiveViewMode(mode);
        },
      }),
      toolbarPlugin({
        toolbarPosition: "top",
        toolbarContents: () =>
          forceSource ? (
            <>
              <UndoRedo />
              <Separator />
              <DisabledViewModeControls />
              <Separator />
              <span className="editor-source-mode-label">
                Guides lock source mode
              </span>
            </>
          ) : (
            <>
              <DiffSourceToggleWrapper
                options={["rich-text", "source"]}
                SourceToolbar={<UndoRedo />}
              >
                <UndoRedo />
                <Separator />
                <ConditionalContents
                  options={[
                    {
                      when: (editor) => {
                        const node = editor?.rootNode;
                        return (
                          $isDirectiveNode(node) &&
                          ["note", "tip", "danger", "info", "caution"].includes(
                            node.getMdastNode().name,
                          )
                        );
                      },
                      contents: () => <ChangeAdmonitionType />,
                    },
                    { fallback: () => <BlockTypeSelect /> },
                  ]}
                />
                <BoldItalicUnderlineToggles />
                <CodeToggle />
                <StrikeThroughSupSubToggles options={["Strikethrough"]} />
                <HighlightToggle />
                <Separator />
                <ListsToggle options={["bullet", "number", "check"]} />
                <CreateLinkPreservingSelection />
                <InsertImage />
                <Separator />
                <InsertCodeBlock />
                <InsertTable />
                <InsertThematicBreak />
                <InsertAdmonition />
                <InsertFrontmatter />
                <ConditionalContents
                  options={[
                    {
                      when: (editor) => editor?.editorType === "codeblock",
                      contents: () => <ChangeCodeMirrorLanguage />,
                    },
                  ]}
                />
              </DiffSourceToggleWrapper>
            </>
          ),
      }),
    ],
    [
      displayExtensions,
      forceSource,
      initialViewMode,
      notePath,
      onImageUpload,
      onMarkdownErrorCleared,
      onViewModeChange,
      sourceFirst,
      tabExtensions,
    ],
  );

  useEffect(() => {
    if (activeViewMode !== "source") {
      return;
    }
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    let attempt = 0;
    let timer = 0;
    const sync = () => {
      const view = sourceEditorView(shell);
      if (!view) {
        if (attempt < 20) {
          attempt += 1;
          timer = window.setTimeout(sync, 20);
        }
        return;
      }
      const source = calloutsToDirectives(editorMarkdown);
      if (view.state.doc.toString() !== source) {
        const anchor = Math.min(view.state.selection.main.head, source.length);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: source },
          selection: { anchor },
          annotations: Transaction.addToHistory.of(false),
        });
      }
    };
    timer = window.setTimeout(sync, 0);
    return () => window.clearTimeout(timer);
  }, [activeViewMode, editorMarkdown, notePath]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    applyInlineTagColors(shell, tagColors);
    applyHeadingAnchors(shell);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          applyInlineTagColor(mutation.target.parentElement, tagColors);
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            applyInlineTagColor(node, tagColors);
            applyInlineTagColors(node, tagColors);
          } else {
            applyInlineTagColor(node.parentElement, tagColors);
          }
        }
      }
      applyHeadingAnchors(shell);
    });

    observer.observe(shell, {
      attributes: true,
      attributeFilter: ["alt"],
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [tagColors]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    if (!errorLocation) {
      sourceEditorView(shell)?.dispatch({
        effects: setEditorDiagnostic.of(null),
      });
      return;
    }
    let attempt = 0;
    let timer = 0;
    const reveal = () => {
      if (
        revealSourceLocation(
          shell,
          errorLocation,
          errorNavigationRequest > 0,
        ) ||
        attempt >= 20
      ) {
        return;
      }
      attempt += 1;
      timer = window.setTimeout(reveal, 30);
    };
    timer = window.setTimeout(reveal, 0);
    return () => window.clearTimeout(timer);
  }, [
    errorLocation?.column,
    errorLocation?.line,
    errorNavigationRequest,
    notePath,
  ]);

  return (
    <div
      ref={shellRef}
      className={`markdown-editor-shell${
        displaySettings.showLineNumbers
          ? " editor-display--line-numbers"
          : ""
      }`}
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter") {
          return;
        }
        const link = renderedLink(event.target, editorMarkdown);
        if (!link) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onLinkOpen(link.href, link.text);
      }}
      onClickCapture={(event) => {
        const link = renderedLink(event.target, editorMarkdown);
        if (!link) {
          return;
        }
        event.preventDefault();
        if (
          !shouldOpenLinkOnClick(
            link.href,
            event.metaKey || event.ctrlKey,
          )
        ) {
          return;
        }
        event.stopPropagation();
        onLinkOpen(link.href, link.text);
      }}
      onAuxClickCapture={(event) => {
        if (event.button !== 1) {
          return;
        }
        const link = renderedLink(event.target, editorMarkdown);
        if (!link) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onLinkOpen(link.href, link.text);
      }}
    >
      <MDXEditor
        ref={ref}
        markdown={calloutsToDirectives(editorMarkdown)}
        plugins={plugins}
        className="denote-editor-root mdxeditor-full-height"
        contentEditableClassName="denote-editor-content"
        placeholder="Start writing…"
        readOnly={readOnly}
        trim={false}
        spellCheck
        onChange={(value, initialNormalize) => {
          if (!initialNormalize) {
            const markerUpdate = applyTocMarkerViewChange(
              restoreRichTextTagSyntax(directivesToCallouts(value)),
              tocMarkersRef.current!,
              activeViewModeRef.current,
            );
            tocMarkersRef.current = markerUpdate.snapshot;
            onChange(
              restoreMarkdownBoundaryWhitespace(
                markerUpdate.markdown,
                boundaryWhitespace,
              ),
            );
          }
        }}
        onError={({ error, source }) => {
          const diagnostic = {
            message: error,
            source,
            location: locateMarkdownError(source, error),
          };
          if (onMarkdownError) {
            onMarkdownError(diagnostic);
          } else {
            onError(error);
          }
        }}
      />
      <RichCodeBlockCopyButtons rootRef={shellRef} onError={onError} />
    </div>
  );
});

function CreateLinkPreservingSelection() {
  const openLinkDialog = usePublisher(openLinkEditDialog$);
  return (
    <button
      type="button"
      className="editor-toolbar-button"
      aria-label="Create link"
      title="Create link (Command-K / Ctrl-K)"
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => openLinkDialog()}
    >
      <Link2 aria-hidden="true" size={16} />
    </button>
  );
}

const EMPTY_TAG_COLORS: TagColorMap = {};

function applyHeadingAnchors(root: HTMLElement) {
  const usedSlugs = new Set<string>();
  for (const heading of root.querySelectorAll<HTMLElement>(
    ".denote-editor-content h1, .denote-editor-content h2, .denote-editor-content h3, .denote-editor-content h4, .denote-editor-content h5, .denote-editor-content h6",
  )) {
    heading.id = nextHeadingSlug(renderedHeadingText(heading), usedSlugs);
  }
}

function renderedHeadingText(heading: HTMLElement): string {
  return [...heading.childNodes].map(renderedNodeText).join("");
}

function renderedNodeText(node: Node): string {
  if (node instanceof Text) {
    return node.data;
  }
  if (node instanceof HTMLImageElement) {
    return node.alt;
  }
  return [...node.childNodes].map(renderedNodeText).join("");
}

function revealSourceLocation(
  shell: HTMLElement,
  location: MarkdownErrorLocation,
  focus: boolean,
): boolean {
  const editorElement = shell.querySelector<HTMLElement>(
    ".mdxeditor-source-editor .cm-editor",
  );
  const view = editorElement ? EditorView.findFromDOM(editorElement) : null;
  if (!view) {
    return false;
  }
  const line = view.state.doc.line(
    Math.max(1, Math.min(location.line, view.state.doc.lines)),
  );
  const anchor = Math.min(
    line.to,
    line.from + Math.max(0, location.column - 1),
  );
  view.dispatch({
    selection: { anchor },
    effects: [
      setEditorDiagnostic.of(location),
      EditorView.scrollIntoView(anchor, { y: "center" }),
    ],
  });
  if (focus) {
    view.focus();
  }
  return true;
}

function sourceEditorView(shell: HTMLElement): EditorView | null {
  const editorElement = shell.querySelector<HTMLElement>(
    ".mdxeditor-source-editor .cm-editor",
  );
  return editorElement ? EditorView.findFromDOM(editorElement) : null;
}

function applyInlineTagColors(root: HTMLElement, colors: TagColorMap) {
  for (const element of root.querySelectorAll<HTMLElement>(
    ".denote-inline-tag",
  )) {
    applyInlineTagColor(element, colors);
  }
}

function applyInlineTagColor(
  element: HTMLElement | null,
  colors: TagColorMap,
) {
  if (!element?.matches(".denote-inline-tag")) {
    return;
  }
  const tag = normalizeTag(element.textContent ?? "");
  if (!tag) {
    return;
  }
  const style = tagColorStyle(resolveTagColor(tag, colors));
  element.dataset.tag = tag;
  element.style.setProperty("--tag-color", style["--tag-color"]);
}

function DisabledViewModeControls() {
  const guidance =
    "Disable line numbers and invisible-character guides to switch editor modes.";
  return (
    <span
      className="editor-disabled-modes"
      title={guidance}
      role="note"
      tabIndex={0}
      aria-label={guidance}
    >
      <button
        type="button"
        disabled
        aria-label="Rich text mode unavailable while display guides are enabled"
        aria-describedby="editor-disabled-mode-guidance"
      >
        Rich
      </button>
      <button
        type="button"
        disabled
        aria-label="Source mode locked while display guides are enabled"
        aria-describedby="editor-disabled-mode-guidance"
        aria-pressed="true"
      >
        Source
      </button>
      <span id="editor-disabled-mode-guidance" className="sr-only">
        {guidance}
      </span>
    </span>
  );
}

function RichCodeBlockCopyButtons({
  rootRef,
  onError,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  onError: (message: string) => void;
}) {
  const [targets, setTargets] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const markedTargets = new Set<HTMLElement>();
    const scan = () => {
      const next = [
        ...root.querySelectorAll<HTMLElement>(".denote-editor-content pre"),
        ...root.querySelectorAll<HTMLElement>(
          ".denote-editor-content .cm-editor",
        ),
      ]
        .map((target) =>
          target.matches("pre")
            ? target
            : (target.parentElement?.parentElement ?? target),
        )
        .filter(
          (target, index, values) =>
            values.indexOf(target) === index && target.isConnected,
        );
      for (const target of markedTargets) {
        if (!next.includes(target)) {
          target.classList.remove(
            "rich-code-block",
            "rich-code-block--editor",
          );
          markedTargets.delete(target);
        }
      }
      for (const target of next) {
        target.classList.add("rich-code-block");
        if (target.querySelector(".cm-editor")) {
          target.classList.add("rich-code-block--editor");
        } else {
          target.classList.remove("rich-code-block--editor");
        }
        markedTargets.add(target);
      }
      setTargets((current) =>
        current.length === next.length &&
        current.every((target, index) => target === next[index])
          ? current
          : next,
      );
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const target of markedTargets) {
        target.classList.remove(
          "rich-code-block",
          "rich-code-block--editor",
        );
      }
    };
  }, [rootRef]);

  return targets.map((target, index) =>
    createPortal(
      <CodeBlockCopyButton
        key={index}
        target={target}
        onError={onError}
      />,
      target,
    ),
  );
}

function CodeBlockCopyButton({
  target,
  onError,
}: {
  target: HTMLElement;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rich-code-block__copy"
      contentEditable={false}
      aria-label="Copy code block"
      title="Copy code block"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        void api
          .copyFileContent(codeBlockText(target))
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          })
          .catch((caught) => onError(errorMessage(caught)));
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function codeBlockText(target: HTMLElement): string {
  const editor = target.querySelector<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (view) {
    return view.state.doc.toString();
  }
  return target.querySelector("code")?.textContent ?? "";
}

function renderedLink(
  target: EventTarget | null,
  markdown: string,
): { href: string; text: string } | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) {
    return null;
  }
  const href = link.getAttribute("href") ?? "";
  const text = link.textContent ?? "";
  return {
    href: recoverMarkdownLinkTarget(markdown, text, href) ?? href,
    text,
  };
}
