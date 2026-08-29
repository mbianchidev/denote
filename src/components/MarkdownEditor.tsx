import {
  $isDirectiveNode,
  AdmonitionDirectiveDescriptor,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeAdmonitionType,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  CreateLink,
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
  quotePlugin,
  realmPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  viewMode$,
} from "@mdxeditor/editor";
import { EditorView } from "@codemirror/view";
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
import {
  createEditorDisplayExtensions,
  denoteCodeMirrorTheme,
} from "../lib/editorExtensions";
import {
  hasEditorDisplayGuides,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";
import { denoteHashtagPlugin } from "../lib/hashtagPlugin";
import { shouldOpenLinkOnClick } from "../lib/links";
import {
  calloutsToDirectives,
  captureMarkdownBoundaryWhitespace,
  directivesToCallouts,
  hasUnsupportedRichMarkdown,
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
}>({
  init(realm, params) {
    let ready = false;
    let previousMode = params?.mode ?? "rich-text";
    realm.sub(realm.pipe(viewMode$), (mode) => {
      if (!ready) {
        if (mode !== "diff") {
          previousMode = mode;
        }
        return;
      }
      if (mode !== "diff" && mode !== previousMode) {
        previousMode = mode;
        params?.onChange(mode);
      }
    });
    queueMicrotask(() => {
      ready = true;
    });
  },
  postInit(realm, params) {
    realm.pub(viewMode$, params?.mode ?? "rich-text");
  },
});

interface MarkdownEditorProps {
  notePath: string;
  markdown: string;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  preferredViewMode: MarkdownViewMode;
  readOnly: boolean;
  tagColors?: TagColorMap;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onLinkOpen: (href: string, text: string) => void;
  onViewModeChange: (mode: MarkdownViewMode) => void;
  onImageUpload: (notePath: string, file: File) => Promise<string>;
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
    tagColors = EMPTY_TAG_COLORS,
    onChange,
    onError,
    onLinkOpen,
    onViewModeChange,
    onImageUpload,
  },
  ref,
) {
  const sourceFirst = useRef(hasUnsupportedRichMarkdown(markdown)).current;
  const shellRef = useRef<HTMLDivElement>(null);
  const initialPreferredViewMode = useRef(preferredViewMode).current;
  const onLinkOpenRef = useRef(onLinkOpen);
  onLinkOpenRef.current = onLinkOpen;
  const forceSource = hasEditorDisplayGuides(displaySettings);
  const initialViewMode: MarkdownViewMode =
    sourceFirst || forceSource ? "source" : initialPreferredViewMode;
  const displayExtensions = useMemo(
    () => createEditorDisplayExtensions(displaySettings, lineEnding, false),
    [displaySettings, lineEnding],
  );
  const boundaryWhitespace = useRef(
    captureMarkdownBoundaryWhitespace(markdown),
  ).current;
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
        codeMirrorExtensions: [denoteCodeMirrorTheme],
        codeBlockLanguages: {
          text: "Plain text",
          bash: "Bash",
          css: "CSS",
          html: "HTML",
          javascript: "JavaScript",
          json: "JSON",
          jsx: "JSX",
          markdown: "Markdown",
          python: "Python",
          rust: "Rust",
          sql: "SQL",
          tsx: "TSX",
          typescript: "TypeScript",
          yaml: "YAML",
        },
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
          ...displayExtensions,
        ],
      }),
      viewModePreferencePlugin({
        mode: initialViewMode,
        onChange: onViewModeChange,
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
                <CreateLink />
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
      onViewModeChange,
      sourceFirst,
    ],
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    applyInlineTagColors(shell, tagColors);
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
    });
    observer.observe(shell, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [tagColors]);

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
        const link = renderedLink(event.target, markdown);
        if (!link) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onLinkOpen(link.href, link.text);
      }}
      onClickCapture={(event) => {
        const link = renderedLink(event.target, markdown);
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
        const link = renderedLink(event.target, markdown);
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
        markdown={calloutsToDirectives(markdown)}
        plugins={plugins}
        className="denote-editor-root mdxeditor-full-height"
        contentEditableClassName="denote-editor-content"
        placeholder="Start writing…"
        readOnly={readOnly}
        trim={false}
        spellCheck
        onChange={(value, initialNormalize) => {
          if (!initialNormalize) {
            onChange(
              restoreMarkdownBoundaryWhitespace(
                restoreRichTextTagSyntax(directivesToCallouts(value)),
                boundaryWhitespace,
              ),
            );
          }
        }}
        onError={({ error }) => onError(error)}
      />
      <RichCodeBlockCopyButtons rootRef={shellRef} onError={onError} />
    </div>
  );
});

const EMPTY_TAG_COLORS: TagColorMap = {};

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
