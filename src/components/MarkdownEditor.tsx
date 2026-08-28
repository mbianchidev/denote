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
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import { forwardRef, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { createEditorDisplayExtensions } from "../lib/editorExtensions";
import {
  hasEditorDisplayGuides,
  type EditorDisplaySettings,
} from "../lib/editorDisplay";
import { shouldOpenLinkOnClick } from "../lib/links";
import {
  calloutsToDirectives,
  captureMarkdownBoundaryWhitespace,
  directivesToCallouts,
  hasUnsupportedRichMarkdown,
  recoverMarkdownLinkTarget,
  restoreMarkdownBoundaryWhitespace,
} from "../lib/markdown";
import type { FileLineEnding } from "../types";

interface MarkdownEditorProps {
  notePath: string;
  markdown: string;
  lineEnding: FileLineEnding;
  displaySettings: EditorDisplaySettings;
  readOnly: boolean;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onLinkOpen: (href: string, text: string) => void;
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
    readOnly,
    onChange,
    onError,
    onLinkOpen,
    onImageUpload,
  },
  ref,
) {
  const sourceFirst = useRef(hasUnsupportedRichMarkdown(markdown)).current;
  const onLinkOpenRef = useRef(onLinkOpen);
  onLinkOpenRef.current = onLinkOpen;
  const forceSource = hasEditorDisplayGuides(displaySettings);
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
        viewMode: sourceFirst || forceSource ? "source" : "rich-text",
        diffMarkdown: "",
        readOnlyDiff: false,
        codeMirrorExtensions: displayExtensions,
      }),
      toolbarPlugin({
        toolbarPosition: "top",
        toolbarContents: () =>
          forceSource ? (
            <>
              <UndoRedo />
              <Separator />
              <span className="editor-source-mode-label">
                Source guides enabled
              </span>
            </>
          ) : (
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
          ),
      }),
    ],
    [displayExtensions, forceSource, notePath, onImageUpload, sourceFirst],
  );

  return (
    <div
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
        className="denote-editor-root"
        contentEditableClassName="denote-editor-content"
        placeholder="Start writing…"
        readOnly={readOnly}
        trim={false}
        spellCheck
        onChange={(value, initialNormalize) => {
          if (!initialNormalize) {
            onChange(
              restoreMarkdownBoundaryWhitespace(
                directivesToCallouts(value),
                boundaryWhitespace,
              ),
            );
          }
        }}
        onError={({ error }) => onError(error)}
      />
    </div>
  );
});

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
