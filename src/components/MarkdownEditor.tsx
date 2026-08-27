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
import { forwardRef, useMemo } from "react";
import { api } from "../lib/api";
import {
  calloutsToDirectives,
  directivesToCallouts,
} from "../lib/markdown";

interface MarkdownEditorProps {
  vaultPath: string;
  notePath: string;
  markdown: string;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onLinkOpen: (href: string) => void;
}

export const MarkdownEditor = forwardRef<
  MDXEditorMethods,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    vaultPath,
    notePath,
    markdown,
    onChange,
    onError,
    onLinkOpen,
  },
  ref,
) {
  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      linkPlugin({ disableAutoLink: false }),
      linkDialogPlugin({ showLinkTitleField: true }),
      imagePlugin({
        imageUploadHandler: (file) =>
          api.saveAttachment(vaultPath, notePath, file),
        imagePreviewHandler: async (source) => {
          if (
            source.startsWith("data:") ||
            source.startsWith("http://") ||
            source.startsWith("https://")
          ) {
            return source;
          }
          return api.readImageDataUrl(vaultPath, source, notePath);
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
        viewMode: "rich-text",
        diffMarkdown: "",
        readOnlyDiff: false,
      }),
      toolbarPlugin({
        toolbarPosition: "top",
        toolbarContents: () => (
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
    [notePath, vaultPath],
  );

  return (
    <div
      className="markdown-editor-shell"
      onClickCapture={(event) => {
        if (!(event.metaKey || event.ctrlKey)) {
          return;
        }
        const target = event.target as HTMLElement;
        const link = target.closest<HTMLAnchorElement>("a[href]");
        if (link) {
          event.preventDefault();
          onLinkOpen(link.getAttribute("href") ?? "");
        }
      }}
    >
      <MDXEditor
        ref={ref}
        markdown={calloutsToDirectives(markdown)}
        plugins={plugins}
        className="denote-editor-root"
        contentEditableClassName="denote-editor-content"
        placeholder="Start writing…"
        spellCheck
        onChange={(value, initialNormalize) => {
          if (!initialNormalize) {
            onChange(directivesToCallouts(value));
          }
        }}
        onError={({ error }) => onError(error)}
      />
    </div>
  );
});
