import {
  $createGenericHTMLNode,
  $isDirectiveNode,
  AdmonitionDirectiveDescriptor,
  addImportVisitor$,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeAdmonitionType,
  CodeToggle,
  type CodeBlockEditorDescriptor,
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
  type MdastImportVisitor,
  type MDXEditorMethods,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
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
import { Compartment, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $isRootNode,
} from "lexical";
import { Link2 } from "lucide-react";
import type { Html, Paragraph, Parent } from "mdast";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  SafeRichHtmlRenderProvider,
  safeRichHtmlPlugin,
} from "./SafeRichHtmlNode";
import {
  DenoteCodeBlockEditor,
  DenoteCodeBlockEditorSettingsProvider,
} from "./DenoteCodeBlockEditor";
import { referenceMarkdownPlugin } from "./ReferenceMarkdownNode";
import { api, errorMessage } from "../lib/api";
import {
  createEditorDiagnosticExtensions,
  createEditorDisplayExtensions,
  createPluginDecorationExtensions,
  createEditorTabExtensions,
  denoteCodeMirrorTheme,
  markdownLinkKeymap,
  setEditorDiagnostic,
} from "../lib/editorExtensions";
import {
  hasEditorDisplayGuides,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";
import type { PluginEditorDecoration } from "@denote/plugin-sdk";
import { denoteHashtagPlugin } from "../lib/hashtagPlugin";
import { shouldOpenLinkOnClick } from "../lib/links";
import {
  locateMarkdownError,
  type MarkdownErrorLocation,
} from "../lib/markdownErrors";
import {
  hasIncompleteStandardMarkdownAngle,
  restoreStandardMarkdownAngles,
} from "../lib/mdxCompatibility";
import {
  applyTocMarkerViewChange,
  captureTocMarkers,
  captureThematicBreaks,
  captureMarkdownBoundaryWhitespace,
  directivesToCallouts,
  hasUnsupportedRichMarkdown,
  hasSupportedDetailsMarkdown,
  markdownEditorSource,
  nextHeadingSlug,
  normalizeBareSpaceLinkDestinations,
  recoverMarkdownLinkTarget,
  restoreRichTextTagSyntax,
  restoreMarkdownBoundaryWhitespace,
  restoreThematicBreaks,
} from "../lib/markdown";
import type { MarkdownViewMode } from "../lib/markdownView";
import { captureReferenceMarkdown } from "../lib/referenceMarkdown";
import { findCaseInsensitiveMatches } from "../lib/textMatch";
import {
  normalizeTag,
  resolveTagColor,
  tagColorStyle,
  type TagColorMap,
} from "../lib/tagColors";
import type { EditorSearchNavigation, FileLineEnding } from "../types";
import type { EmojiEditorBinding } from "../lib/emojiHost";
import { EmojiSourceHistory, emojiSourcePatch } from "../lib/emoji";
import { createEmojiSourceExtension, createEmojiSourceHistoryExtension } from "../lib/emojiSource";
import { EmojiRichContext, emojiRichPlugin, type EmojiRichBinding } from "../lib/emojiRich";

const viewModePreferencePlugin = realmPlugin<{
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
  onErrorCleared?: () => void;
  isSourceForced?: () => boolean;
  suppressPersistence?: () => boolean;
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
        if (
          !forcingSource &&
          !params?.isSourceForced?.() &&
          !params?.suppressPersistence?.()
        ) {
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

const standardMarkdownHtmlVisitor: MdastImportVisitor<Html> = {
  testNode: "html",
  visitNode({ mdastNode, actions, lexicalParent }) {
    const value = mdastNode.value.trim();
    if (/^<!-- \/?toc -->$/.test(value)) {
      return;
    }
    const summary = /^<summary>([^<>\r\n]*)<\/summary>$/.exec(value);
    if (summary) {
      const summaryNode = $createGenericHTMLNode(
        "summary",
        "mdxJsxFlowElement",
        [],
      );
      summaryNode.append($createTextNode(summary[1]));
      actions.addAndStepInto(summaryNode);
      return;
    }
    const text = $createTextNode(mdastNode.value);
    text.setFormat(actions.getParentFormatting());
    const style = actions.getParentStyle();
    if (style) {
      text.setStyle(style);
    }
    if ($isRootNode(lexicalParent)) {
      lexicalParent.append($createParagraphNode().append(text));
    } else {
      actions.addAndStepInto(text);
    }
  },
  priority: 100,
};

interface MdxSummaryElement {
  type: "mdxJsxTextElement";
  name: "summary";
  attributes: [];
  children: Parent["children"];
}

const detailsSummaryParagraphVisitor: MdastImportVisitor<Paragraph> = {
  testNode(node) {
    if (node.type !== "paragraph" || node.children.length !== 1) {
      return false;
    }
    const child = node.children[0] as unknown as Partial<MdxSummaryElement>;
    return (
      child.type === "mdxJsxTextElement" &&
      child.name === "summary" &&
      Array.isArray(child.attributes) &&
      child.attributes.length === 0 &&
      Array.isArray(child.children)
    );
  },
  visitNode({ mdastNode, actions, lexicalParent }) {
    if (!$isElementNode(lexicalParent)) {
      throw new Error("Summary must be imported into an element node.");
    }
    const summary = mdastNode.children[0] as unknown as MdxSummaryElement;
    const summaryNode = $createGenericHTMLNode(
      "summary",
      "mdxJsxFlowElement",
      [],
    );
    lexicalParent.append(summaryNode);
    actions.visitChildren(summary as unknown as Parent, summaryNode);
  },
  priority: 200,
};

const standardMarkdownCompatibilityPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, [
      detailsSummaryParagraphVisitor,
      standardMarkdownHtmlVisitor,
    ]);
  },
});

const denoteCodeBlockEditorDescriptor: CodeBlockEditorDescriptor = {
  priority: 100,
  match: () => true,
  Editor: DenoteCodeBlockEditor,
};

interface MarkdownEditorProps {
  notePath: string;
  markdown: string;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  pluginDecorations?: PluginEditorDecoration[];
  emoji?: EmojiEditorBinding;
  preferredViewMode: MarkdownViewMode;
  projectSourceMode?: boolean;
  readOnly: boolean;
  errorLocation?: MarkdownErrorLocation;
  errorNavigationRequest?: number;
  searchNavigation?: EditorSearchNavigation;
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
    pluginDecorations = [],
    emoji,
    preferredViewMode,
    projectSourceMode = false,
    readOnly,
    errorLocation,
    errorNavigationRequest = 0,
    searchNavigation,
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
  const editorSource = useMemo(() => markdownEditorSource(markdown), [markdown]);
  const referenceSnapshot = useMemo(
    () => captureReferenceMarkdown(editorSource),
    [editorSource],
  );
  const referenceSnapshotRef = useRef(referenceSnapshot);
  referenceSnapshotRef.current = referenceSnapshot;
  const detectedSourceOnly = hasUnsupportedRichMarkdown(markdown);
  const renderDetails = hasSupportedDetailsMarkdown(markdown);
  const shellRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef(emoji);
  const emojiSourceRef = useRef(markdown);
  const [sourceLineBreak] = useState(() => markdown.includes("\r\n") ? "\r\n" : markdown.includes("\r") ? "\r" : "\n");
  emojiSourceRef.current = markdown;
  const [emojiSerialization] = useState(() => new EmojiSourceHistory());
  const emojiCompartment = useRef(new Compartment()).current;
  const configuredEmojiSource = useRef<{ view: EditorView; binding: EmojiEditorBinding | undefined } | null>(null);
  emojiRef.current = emoji && /\.(md|markdown)$/i.test(notePath) ? {
    ...emoji,
    prepareSource: (document, from, to, unicode) => {
      const patch = emojiSourcePatch(emojiSourceRef.current, document, from, to, unicode);
      if (patch === null) return false;
      emojiSerialization.record(document, emojiSourceRef.current);
      emojiSerialization.prepare(patch);
      return true;
    },
  } : undefined;
  const emojiRichBinding = useMemo<EmojiRichBinding | undefined>(() => emoji ? ({
    host: emoji.host,
    scope: emoji.scope,
    source: () => emojiSourceRef.current,
    sourceSnapshot: () => referenceSnapshotRef.current,
    prepare: (source) => { emojiSerialization.prepare(source); },
  }) : undefined, [emoji?.host, emoji?.scope, emojiSerialization]);
  const emojiSourceExtensions = useMemo(() => [
    createEmojiSourceHistoryExtension((history) => emojiSerialization.beforeChange(history)),
    emojiCompartment.of(emojiRef.current ? createEmojiSourceExtension(() => emojiRef.current) : []),
  ], [emojiCompartment, emojiSerialization]);
  const initialPreferredViewMode = useRef(preferredViewMode).current;
  const onLinkOpenRef = useRef(onLinkOpen);
  onLinkOpenRef.current = onLinkOpen;
  const displayGuidesForceSource =
    hasEditorDisplayGuides(displaySettings);
  const initialSourceOnly = useRef(detectedSourceOnly).current;
  const initialViewMode: MarkdownViewMode =
    projectSourceMode || initialSourceOnly || displayGuidesForceSource
      ? "source"
      : initialPreferredViewMode;
  const activeViewModeRef = useRef<MarkdownViewMode>(initialViewMode);
  const [activeViewMode, setActiveViewMode] =
    useState<MarkdownViewMode>(initialViewMode);
  const desiredHtmlProcessing = renderDetails && !detectedSourceOnly;
  const [htmlProcessing, setHtmlProcessing] = useState(
    desiredHtmlProcessing,
  );
  const realmInitialViewModeRef = useRef(initialViewMode);
  const realmInitialViewMode = realmInitialViewModeRef.current;
  const sourceOnly =
    detectedSourceOnly &&
    !(
      activeViewMode === "rich-text" &&
      hasIncompleteStandardMarkdownAngle(markdown)
    );
  const forceSource =
    projectSourceMode || sourceOnly || displayGuidesForceSource;
  const previousCommittedForceSource = useRef(forceSource);
  const [restorePreferredViewMode, setRestorePreferredViewMode] = useState(false);
  const clearPreferredViewModeRestoration = useCallback(
    () => setRestorePreferredViewMode(false),
    [],
  );
  const sourceForcedRef = useRef(forceSource);
  sourceForcedRef.current = forceSource;
  const transientViewModeChangeRef = useRef(false);
  const searchForcedSourceRef = useRef(false);
  const handledSearchRequest = useRef(0);
  useEffect(() => {
    const shouldRestore =
      previousCommittedForceSource.current && !forceSource;
    previousCommittedForceSource.current = forceSource;
    if (shouldRestore) {
      setRestorePreferredViewMode(true);
    }
  }, [forceSource]);
  useEffect(() => {
    if (
      activeViewMode === "rich-text" &&
      htmlProcessing !== desiredHtmlProcessing
    ) {
      realmInitialViewModeRef.current = forceSource
        ? "source"
        : activeViewMode;
      setHtmlProcessing(desiredHtmlProcessing);
    }
  }, [
    activeViewMode,
    desiredHtmlProcessing,
    forceSource,
    htmlProcessing,
  ]);
  const sourceLock = useMemo(
    () =>
      projectSourceMode
        ? {
            guidance:
              "Rich text mode is unavailable because this file is inside a code workspace.",
            richLabel:
              "Rich text mode unavailable inside a code workspace",
            sourceLabel: "Source mode locked inside a code workspace",
            status: "Code workspace source mode",
          }
        : sourceOnly
        ? {
            guidance:
              "Rich text mode is unavailable because this file contains source-only Markdown syntax.",
            richLabel:
              "Rich text mode unavailable for source-only Markdown syntax",
            sourceLabel: "Source mode locked for source-only Markdown syntax",
            status: "Source-only Markdown syntax",
          }
        : {
            guidance:
              "Disable line numbers and invisible-character guides to switch editor modes.",
            richLabel:
              "Rich text mode unavailable while display guides are enabled",
            sourceLabel: "Source mode locked while display guides are enabled",
            status: "Guides lock source mode",
          },
    [projectSourceMode, sourceOnly],
  );
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
  const pluginDecorationExtensions = useMemo(
    () => createPluginDecorationExtensions(pluginDecorations),
    [pluginDecorations],
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
  const thematicBreaksRef = useRef<
    ReturnType<typeof captureThematicBreaks> | null
  >(null);
  if (thematicBreaksRef.current === null) {
    thematicBreaksRef.current = captureThematicBreaks(markdown);
  }
  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      denoteHashtagPlugin(),
      emojiRichPlugin({ beforeChange: (history) => emojiSerialization.beforeChange(history) }),
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
          try {
            return await api.readImageDataUrl(source, notePath);
          } catch (caught) {
            onError(errorMessage(caught));
            throw caught;
          }
        },
        allowSetImageDimensions: true,
      }),
      tablePlugin(),
      codeBlockPlugin({
        defaultCodeBlockLanguage: "",
        codeBlockEditorDescriptors: [denoteCodeBlockEditorDescriptor],
      }),
      frontmatterPlugin(),
      directivesPlugin({
        directiveDescriptors: [AdmonitionDirectiveDescriptor],
      }),
      diffSourcePlugin({
        viewMode: realmInitialViewMode,
        diffMarkdown: "",
        readOnlyDiff: false,
        codeMirrorExtensions: [
          denoteCodeMirrorTheme,
          markdownLinkKeymap,
          ...displayExtensions,
          ...pluginDecorationExtensions,
          emojiSourceExtensions,
        ],
      }),
      safeRichHtmlPlugin(),
      referenceMarkdownPlugin({ snapshot: referenceSnapshotRef }),
      standardMarkdownCompatibilityPlugin(),
      viewModePreferencePlugin({
        mode: realmInitialViewMode,
        isSourceForced: () => sourceForcedRef.current,
        suppressPersistence: () =>
          searchForcedSourceRef.current ||
          transientViewModeChangeRef.current,
        onChange: onViewModeChange,
        onErrorCleared: onMarkdownErrorCleared,
        onModeChange: (mode) => {
          activeViewModeRef.current = mode;
          setActiveViewMode(mode);
          if (mode === "source" && searchForcedSourceRef.current) {
            queueMicrotask(() => {
              searchForcedSourceRef.current = false;
            });
          }
        },
      }),
      toolbarPlugin({
        toolbarPosition: "top",
        toolbarContents: () =>
          forceSource ? (
            <>
              <EnforceSourceMode />
              <UndoRedo />
              <Separator />
              <DisabledViewModeControls
                guidance={sourceLock.guidance}
                richLabel={sourceLock.richLabel}
                sourceLabel={sourceLock.sourceLabel}
              />
              <Separator />
              <span className="editor-source-mode-label">
                {sourceLock.status}
              </span>
            </>
          ) : (
            <>
              {restorePreferredViewMode ? (
                <RestorePreferredViewMode
                  mode={preferredViewMode}
                  onRestored={clearPreferredViewModeRestoration}
                  suppressPersistence={transientViewModeChangeRef}
                />
              ) : null}
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
              </DiffSourceToggleWrapper>
            </>
          ),
      }),
    ],
    [
      displayExtensions,
      clearPreferredViewModeRestoration,
      sourceLock,
      forceSource,
      initialViewMode,
      realmInitialViewMode,
      notePath,
      onError,
      onImageUpload,
      onMarkdownErrorCleared,
      onViewModeChange,
      pluginDecorationExtensions,
      emojiSourceExtensions,
      emojiSerialization,
      preferredViewMode,
      projectSourceMode,
      restorePreferredViewMode,
      sourceOnly,
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
      const source = editorSource;
      const previous = configuredEmojiSource.current;
      if (previous?.view !== view || previous.binding?.host !== emojiRef.current?.host || previous.binding?.scope !== emojiRef.current?.scope) {
        configuredEmojiSource.current = { view, binding: emojiRef.current };
        view.dispatch({
          effects: emojiCompartment.reconfigure(emojiRef.current ? createEmojiSourceExtension(() => emojiRef.current) : []),
        });
      }
      if (view.state.doc.toString() !== source.replace(/\r\n?/g, "\n")) {
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
  }, [activeViewMode, emoji?.host, emoji?.scope, emojiCompartment, editorSource, notePath]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    applyTagPills(shell, tagColors);
    applyHeadingAnchors(shell);
    applyGeneratedTocPresentation(shell, tocMarkersRef.current!);
    normalizeRenderedImageDimensions(shell);
    const observer = new MutationObserver(() => {
      applyTagPills(shell, tagColors);
      applyHeadingAnchors(shell);
      applyGeneratedTocPresentation(shell, tocMarkersRef.current!);
      normalizeRenderedImageDimensions(shell);
    });

    observer.observe(shell, {
      attributes: true,
      attributeFilter: ["alt", "height", "width"],
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

  useEffect(() => {
    const shell = shellRef.current;
    if (
      !shell ||
      !searchNavigation ||
      searchNavigation.request <= 0 ||
      handledSearchRequest.current === searchNavigation.request
    ) {
      return;
    }
    let attempt = 0;
    let timer = 0;
    const reveal = () => {
      if (activeViewMode !== "source") {
        const result = revealRichTextSearch(shell, markdown, searchNavigation);
        if (result === "source-required") {
          searchForcedSourceRef.current = true;
          if (switchToSourceMode(shell)) {
            return;
          }
          searchForcedSourceRef.current = false;
        } else if (result === "revealed") {
          handledSearchRequest.current = searchNavigation.request;
          return;
        }
      }
      const revealed =
        activeViewMode === "source" &&
        revealSourceSearch(shell, searchNavigation);
      if (revealed || attempt >= 20) {
        handledSearchRequest.current = searchNavigation.request;
        return;
      }
      attempt += 1;
      timer = window.setTimeout(reveal, 30);
    };
    timer = window.setTimeout(reveal, 0);
    return () => window.clearTimeout(timer);
  }, [activeViewMode, markdown, notePath, searchNavigation]);

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
        const target =
          event.target instanceof Element ? event.target : null;
        const requestedRichMode =
          target?.closest<HTMLButtonElement>(
            'button[aria-label="Rich text"]',
          ) ?? null;
        if (
          requestedRichMode &&
          activeViewMode === "source" &&
          htmlProcessing !== desiredHtmlProcessing
        ) {
          event.preventDefault();
          event.stopPropagation();
          realmInitialViewModeRef.current = "rich-text";
          activeViewModeRef.current = "rich-text";
          setActiveViewMode("rich-text");
          onViewModeChange("rich-text");
          setHtmlProcessing(desiredHtmlProcessing);
          return;
        }
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
      <EmojiRichContext.Provider value={emojiRichBinding}>
      <SafeRichHtmlRenderProvider notePath={notePath} onError={onError}>
        <DenoteCodeBlockEditorSettingsProvider
          readOnly={readOnly}
          tabExtensions={tabExtensions}
          onError={(caught) => onError(errorMessage(caught))}
        >
          <MDXEditor
            key={htmlProcessing ? "details-html" : "standard-markdown"}
            ref={ref}
            markdown={editorSource}
            plugins={plugins}
            className="denote-editor-root mdxeditor-full-height"
            contentEditableClassName="denote-editor-content"
            placeholder="Start writing…"
            readOnly={readOnly}
            suppressHtmlProcessing={!htmlProcessing}
            trim={false}
            spellCheck
            onChange={(value, initialNormalize) => {
              const serialization = emojiSerialization;
              if (initialNormalize) serialization.record(value, emojiSourceRef.current);
              if (!initialNormalize) {
                const exactSource = serialization.restore(value);
                if (exactSource !== undefined) {
                  const output = sourceLineBreak !== "\n" && activeViewModeRef.current === "source"
                    ? exactSource.replace(/\r\n?/g, "\n").replace(/\n/g, sourceLineBreak)
                    : exactSource;
                  tocMarkersRef.current = captureTocMarkers(output);
                  thematicBreaksRef.current = captureThematicBreaks(output);
                  serialization.record(value, output);
                  emojiSourceRef.current = output;
                  onChange(output);
                  return;
                }
                let restoredMarkdown = restoreRichTextTagSyntax(
                  directivesToCallouts(value),
                );
                if (activeViewModeRef.current === "rich-text") {
                  restoredMarkdown = restoreThematicBreaks(
                    restoredMarkdown,
                    thematicBreaksRef.current!,
                  );
                } else {
                  thematicBreaksRef.current =
                    captureThematicBreaks(restoredMarkdown);
                }
                const markerUpdate = applyTocMarkerViewChange(
                  activeViewModeRef.current === "rich-text"
                    ? restoreStandardMarkdownAngles(restoredMarkdown, markdown)
                    : restoredMarkdown,
                  tocMarkersRef.current!,
                  activeViewModeRef.current,
                );
                tocMarkersRef.current = markerUpdate.snapshot;
                thematicBreaksRef.current =
                  captureThematicBreaks(markerUpdate.markdown);
                let output = activeViewModeRef.current === "source" ? markerUpdate.markdown : restoreMarkdownBoundaryWhitespace(
                    markerUpdate.markdown,
                    boundaryWhitespace,
                  );
                if (sourceLineBreak !== "\n" && activeViewModeRef.current === "source") output = output.replace(/\r\n?/g, "\n").replace(/\n/g, sourceLineBreak);
                serialization.record(value, output);
                emojiSourceRef.current = output;
                onChange(output);
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
        </DenoteCodeBlockEditorSettingsProvider>
      </SafeRichHtmlRenderProvider>
      </EmojiRichContext.Provider>
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

function EnforceSourceMode() {
  const setViewMode = usePublisher(viewMode$);
  useEffect(() => {
    setViewMode("source");
  }, [setViewMode]);
  return null;
}

function RestorePreferredViewMode({
  mode,
  onRestored,
  suppressPersistence,
}: {
  mode: MarkdownViewMode;
  onRestored: () => void;
  suppressPersistence: RefObject<boolean>;
}) {
  const setViewMode = usePublisher(viewMode$);
  useEffect(() => {
    suppressPersistence.current = true;
    try {
      setViewMode(mode);
      onRestored();
    } finally {
      suppressPersistence.current = false;
    }
  }, [mode, onRestored, setViewMode, suppressPersistence]);
  return null;
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

function normalizeRenderedImageDimensions(root: HTMLElement) {
  for (const image of root.querySelectorAll<HTMLImageElement>(
    'img[width="inherit"], img[height="inherit"]',
  )) {
    image
      .closest<HTMLElement>('[data-editor-block-type="image"]')
      ?.classList.add("denote-image-block");
    if (image.getAttribute("width") === "inherit") {
      image.removeAttribute("width");
    }
    if (image.getAttribute("height") === "inherit") {
      image.removeAttribute("height");
    }
  }
}

function applyGeneratedTocPresentation(
  root: HTMLElement,
  snapshot: ReturnType<typeof captureTocMarkers>,
) {
  const editor = root.querySelector<HTMLElement>(".denote-editor-content");
  if (!editor) {
    return;
  }
  for (const list of editor.querySelectorAll<HTMLElement>(
    "[data-denote-generated-toc]",
  )) {
    list.classList.remove("denote-generated-toc");
    list.removeAttribute("data-denote-generated-toc");
    list.removeAttribute("aria-label");
  }
  const lists = [...editor.children].filter(
    (
      child,
    ): child is HTMLUListElement | HTMLOListElement =>
      child instanceof HTMLUListElement || child instanceof HTMLOListElement,
  );
  const claimed = new Set<HTMLElement>();
  for (const block of snapshot.blocks) {
    const ordinal = lists[block.listOrdinal];
    const list =
      ordinal &&
      !claimed.has(ordinal) &&
      sameRenderedToc(ordinal, block.items.length, block.links)
        ? ordinal
        : lists.find(
            (candidate) =>
              !claimed.has(candidate) &&
              sameRenderedToc(
                candidate,
                block.items.length,
                block.links,
              ),
          );
    if (!list) {
      continue;
    }
    claimed.add(list);
    list.classList.add("denote-generated-toc");
    list.setAttribute("data-denote-generated-toc", "");
    list.setAttribute("aria-label", "Table of contents");
  }
}

function sameRenderedToc(
  list: HTMLElement,
  expectedItemCount: number,
  expectedLinks: string[],
): boolean {
  const itemCount = [...list.children].filter(
    (child) => child instanceof HTMLLIElement,
  ).length;
  const links = [...list.querySelectorAll<HTMLAnchorElement>("a[href]")].map(
    (anchor) => anchor.getAttribute("href") ?? "",
  );
  return (
    itemCount === expectedItemCount &&
    links.length === expectedLinks.length &&
    links.every((link, index) => link === expectedLinks[index])
  );
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

function revealSourceSearch(
  shell: HTMLElement,
  navigation: EditorSearchNavigation,
): boolean {
  const view = sourceEditorView(shell);
  if (!view) {
    return false;
  }
  const source = view.state.doc.toString();
  const from = Math.max(0, Math.min(navigation.from, source.length));
  const to = Math.max(from, Math.min(navigation.to, source.length));
  const exact =
    source.slice(from, to).toLocaleLowerCase() ===
    navigation.text.toLocaleLowerCase();
  const fallback = exact
    ? { from, to }
    : findCaseInsensitiveMatches(source, navigation.text)[0];
  if (!fallback) {
    return false;
  }
  view.dispatch({
    selection: { anchor: fallback.from, head: fallback.to },
    effects: EditorView.scrollIntoView(fallback.from, { y: "center" }),
  });
  view.focus();
  return true;
}

function switchToSourceMode(shell: HTMLElement): boolean {
  const sourceToggle = shell.querySelector<HTMLButtonElement>(
    'button[aria-label="Source mode"]',
  );
  if (!sourceToggle) {
    return false;
  }
  sourceToggle.click();
  return true;
}

function revealRichTextSearch(
  shell: HTMLElement,
  markdown: string,
  navigation: EditorSearchNavigation,
): "revealed" | "not-ready" | "source-required" {
  const root = shell.querySelector<HTMLElement>(".denote-editor-content");
  if (!root || !navigation.text) {
    return "not-ready";
  }
  const entries: Array<{ node: Text; start: number; end: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let combined = "";
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const start = combined.length;
    combined += textNode.data;
    entries.push({ node: textNode, start, end: combined.length });
    node = walker.nextNode();
  }
  if (!combined && markdown) {
    return "not-ready";
  }
  const sourceMatches = findCaseInsensitiveMatches(markdown, navigation.text);
  const exactTarget = sourceMatches.findIndex(
    (match) => match.from === navigation.from && match.to === navigation.to,
  );
  const targetIndex =
    exactTarget >= 0
      ? exactTarget
      : sourceMatches.reduce(
          (closest, match, index) =>
            closest < 0 ||
            Math.abs(match.from - navigation.from) <
              Math.abs(sourceMatches[closest].from - navigation.from)
              ? index
              : closest,
          -1,
        );
  const renderedMatches = findCaseInsensitiveMatches(
    combined,
    navigation.text,
  );
  if (
    targetIndex < 0 ||
    renderedMatches.length !== sourceMatches.length ||
    !renderedMatches[targetIndex]
  ) {
    return "source-required";
  }
  const { from: matchStart, to: matchEnd } = renderedMatches[targetIndex];
  const startEntry = entries.find(
    (entry) => matchStart >= entry.start && matchStart < entry.end,
  );
  const endEntry = entries.find(
    (entry) => matchEnd > entry.start && matchEnd <= entry.end,
  );
  if (!startEntry || !endEntry) {
    return "not-ready";
  }
  root.focus();
  const range = document.createRange();
  range.setStart(startEntry.node, matchStart - startEntry.start);
  range.setEnd(endEntry.node, matchEnd - endEntry.start);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  startEntry.node.parentElement?.scrollIntoView?.({
    behavior: "smooth",
    block: "center",
  });
  return "revealed";
}

const TAG_ONLY_LINE =
  /^\s*#[\p{L}\p{N}\p{M}_/-]+(?:[ \t]+#[\p{L}\p{N}\p{M}_/-]+)*\s*$/u;

function applyTagPills(root: HTMLElement, colors: TagColorMap) {
  const hashtags = [
    ...root.querySelectorAll<HTMLElement>(".denote-hashtag"),
  ];
  for (const element of hashtags) {
    element.classList.remove("denote-inline-tag");
    delete element.dataset.tag;
    element.style.removeProperty("--tag-color");
  }
  const editor = root.querySelector<HTMLElement>(".denote-editor-content");
  const finalBlock = editor ? lastContentBlock(editor) : null;
  if (!(finalBlock instanceof HTMLParagraphElement)) {
    return;
  }
  const lines = renderedLineText(finalBlock).split("\n");
  const lineText = lines[lines.length - 1] ?? "";
  if (!TAG_ONLY_LINE.test(lineText)) {
    return;
  }
  const breaks = [...finalBlock.querySelectorAll("br")];
  const lastBreak = breaks[breaks.length - 1];
  for (const element of finalBlock.querySelectorAll<HTMLElement>(
    ".denote-hashtag",
  )) {
    if (
      lastBreak &&
      !(
        lastBreak.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    ) {
      continue;
    }
    element.classList.add("denote-inline-tag");
    applyInlineTagColor(element, colors);
  }
}

function lastContentBlock(editor: HTMLElement): HTMLElement | null {
  return (
    [...editor.children]
      .reverse()
      .find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          (renderedLineText(child).trim() !== "" ||
            child.matches("hr, pre, table, ul, ol, blockquote")),
      ) ?? null
  );
}

function renderedLineText(node: Node): string {
  if (node instanceof Text) {
    return node.data;
  }
  if (node instanceof HTMLBRElement) {
    return "\n";
  }
  return [...node.childNodes].map(renderedLineText).join("");
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

function DisabledViewModeControls({
  guidance,
  richLabel,
  sourceLabel,
}: {
  guidance: string;
  richLabel: string;
  sourceLabel: string;
}) {
  const guidanceId = useId();
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
        aria-label={richLabel}
        aria-describedby={guidanceId}
      >
        Rich
      </button>
      <button
        type="button"
        disabled
        aria-label={sourceLabel}
        aria-describedby={guidanceId}
        aria-pressed="true"
      >
        Source
      </button>
      <span id={guidanceId} className="sr-only">
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
          ".denote-editor-content [data-denote-code-block-editor]",
        ),
      ]
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
  const referenceTarget = link.dataset.denoteReferenceTarget;
  if (referenceTarget !== undefined) {
    return { href: referenceTarget, text };
  }
  if (link.hasAttribute("data-denote-safe-rich-html-link")) {
    return { href, text };
  }
  return {
    href: recoverMarkdownLinkTarget(markdown, text, href) ?? href,
    text,
  };
}
