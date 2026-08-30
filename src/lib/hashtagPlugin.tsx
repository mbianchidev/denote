import { HashtagNode, registerLexicalHashtag } from "@lexical/hashtag";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  addComposerChild$,
  addLexicalNode$,
  addNestedEditorChild$,
  addTableCellEditorChild$,
  lexicalTheme$,
  realmPlugin,
} from "@mdxeditor/editor";
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
        hashtag: "denote-inline-tag",
      },
    });
  },
});
