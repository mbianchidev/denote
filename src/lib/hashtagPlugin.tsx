import { HashtagNode, registerLexicalHashtag } from "@lexical/hashtag";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createCodeBlockNode,
  addComposerChild$,
  addLexicalNode$,
  addNestedEditorChild$,
  addTableCellEditorChild$,
  lexicalTheme$,
  realmPlugin,
} from "@mdxeditor/editor";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  TextNode,
} from "lexical";
import { useEffect } from "react";
import { findMarkdownTagMatch } from "./markdown";

function DenoteHashtagPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      registerLexicalHashtag(editor, {
        getHashtagMatch: findMarkdownTagMatch,
      }),
    [editor],
  );

  useEffect(() => {
    const removeLinkTransform = editor.registerNodeTransform(
      TextNode,
      (node) => {
        if (node.hasFormat("code") || $isLinkNode(node.getParent())) {
          return;
        }
        const text = node.getTextContent();
        const match = /\[([^\]\r\n]+)\]\(<([^<>\r\n]+)>\)$/.exec(text);
        if (!match || isEscapedAt(text, match.index)) {
          return;
        }
        let syntaxNode = node;
        if (match.index > 0) {
          [, syntaxNode] = node.splitText(match.index);
        }
        const link = $createLinkNode(match[2]);
        const label = $createTextNode(match[1]);
        label.setFormat(syntaxNode.getFormat());
        label.setStyle(syntaxNode.getStyle());
        link.append(label);
        syntaxNode.replace(link);
        label.selectEnd();
      },
    );
    const removePasteCommand = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const source =
          "clipboardData" in event
            ? event.clipboardData?.getData("text/plain") ?? ""
            : "";
        const match = /^```([^\r\n`]*)\r?\n```[ \t]*$/.exec(source);
        const selection = $getSelection();
        if (!match || !$isRangeSelection(selection)) {
          return false;
        }
        const topLevel = selection.anchor.getNode().getTopLevelElement();
        if (!topLevel || topLevel.getTextContent() !== "") {
          return false;
        }
        event.preventDefault();
        const codeBlock = $createCodeBlockNode({
          code: "",
          language: match[1].trim(),
          meta: "",
        });
        topLevel.replace(codeBlock);
        codeBlock.select();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const removeFenceCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }
        const topLevel = selection.anchor.getNode().getTopLevelElement();
        const match = /^```([^\r\n`]*)$/.exec(topLevel?.getTextContent() ?? "");
        if (!topLevel || !match) {
          return false;
        }
        event?.preventDefault();
        const codeBlock = $createCodeBlockNode({
          code: "",
          language: match[1].trim(),
          meta: "",
        });
        topLevel.replace(codeBlock);
        codeBlock.select();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      removeLinkTransform();
      removePasteCommand();
      removeFenceCommand();
    };
  }, [editor]);

  return null;
}

export const denoteHashtagPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addLexicalNode$]: HashtagNode,
      [addComposerChild$]: DenoteHashtagPlugin,
      [addNestedEditorChild$]: DenoteHashtagPlugin,
      [addTableCellEditorChild$]: DenoteHashtagPlugin,
      [lexicalTheme$]: {
        ...realm.getValue(lexicalTheme$),
        hashtag: "denote-hashtag",
      },
    });
  },
});

function isEscapedAt(source: string, offset: number): boolean {
  let slashCount = 0;
  for (
    let index = offset - 1;
    index >= 0 && source[index] === "\\";
    index -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
