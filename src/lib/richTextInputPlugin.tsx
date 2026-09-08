import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import {
  addComposerChild$,
  addNestedEditorChild$,
  addTableCellEditorChild$,
  realmPlugin,
} from "@mdxeditor/editor";
import {
  $createTabNode,
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_DOWN_COMMAND,
  type LexicalNode,
  PASTE_COMMAND,
  tokenizeRawText,
} from "lexical";
import { useEffect } from "react";

function DenotePlainTextPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let pasteWithoutFormatting = false;
    let resetTimer = 0;
    const clearPasteRequest = () => {
      pasteWithoutFormatting = false;
      if (resetTimer) {
        window.clearTimeout(resetTimer);
        resetTimer = 0;
      }
    };
    const removeKeyDown = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (
          event.key.toLocaleLowerCase() === "v" &&
          event.shiftKey &&
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.isComposing
        ) {
          pasteWithoutFormatting = true;
          if (resetTimer) {
            window.clearTimeout(resetTimer);
          }
          resetTimer = window.setTimeout(clearPasteRequest, 0);
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const removePaste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!pasteWithoutFormatting) {
          return false;
        }
        clearPasteRequest();
        const selection = $getSelection();
        if (
          !("clipboardData" in event) ||
          !$isRangeSelection(selection)
        ) {
          return false;
        }
        event.preventDefault();
        tokenizeRawText(event.clipboardData?.getData("text/plain") ?? "", {
          linebreak: () => {
            const current = $getSelection();
            if ($isRangeSelection(current)) {
              current.insertParagraph();
            }
          },
          tab: () => {
            const current = $getSelection();
            if ($isRangeSelection(current)) {
              current.insertNodes([$createTabNode()]);
            }
          },
          text: (text) => {
            const current = $getSelection();
            if ($isRangeSelection(current)) {
              current.insertText(text);
            }
          },
        });
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    return () => {
      clearPasteRequest();
      removeKeyDown();
      removePaste();
    };
  }, [editor]);

  return null;
}

function DenoteThematicBreakShortcut({
  onInsert,
}: {
  onInsert: (index: number) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (
            event.key !== "-" ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.isComposing
          ) {
            return false;
          }
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            !selection.isCollapsed() ||
            selection.anchor.type !== "text"
          ) {
            return false;
          }
          const anchor = selection.anchor.getNode();
          const paragraph = anchor.getTopLevelElement();
          const root = paragraph?.getParent();
          const paragraphChild = paragraph?.getFirstChild();
          if (
            !paragraph ||
            !$isParagraphNode(paragraph) ||
            !$isRootNode(root) ||
            !$isTextNode(anchor) ||
            !paragraphChild?.is(anchor) ||
            paragraph.getChildrenSize() !== 1 ||
            anchor.getFormat() !== 0 ||
            anchor.getStyle() !== "" ||
            anchor.getMode() !== "normal" ||
            paragraph.getTextContent() !== "--" ||
            selection.anchor.offset !== anchor.getTextContentSize()
          ) {
            return false;
          }
          const breakIndex = root
            .getChildren()
            .slice(0, paragraph.getIndexWithinParent())
            .reduce(
              (count, node) => count + countHorizontalRules(node),
              0,
            );
          event.preventDefault();
          const paragraphKey = paragraph.getKey();
          queueMicrotask(() => {
            editor.update(
              () => {
                const currentParagraph = $getNodeByKey(paragraphKey);
                if (
                  !currentParagraph ||
                  !$isParagraphNode(currentParagraph) ||
                  currentParagraph.getTextContent() !== "--"
                ) {
                  return;
                }
                onInsert(breakIndex);
                const line = $createHorizontalRuleNode();
                const nextParagraph = $createParagraphNode();
                currentParagraph.replace(line);
                line.insertAfter(nextParagraph);
                nextParagraph.select();
              },
              { discrete: true },
            );
          });
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor, onInsert],
  );

  return null;
}

function countHorizontalRules(node: LexicalNode): number {
  if ($isHorizontalRuleNode(node)) {
    return 1;
  }
  if (!$isElementNode(node)) {
    if (
      "getMdastNode" in node &&
      typeof node.getMdastNode === "function"
    ) {
      return countMdastThematicBreaks(node.getMdastNode());
    }
    return 0;
  }
  return node
    .getChildren()
    .reduce((count, child) => count + countHorizontalRules(child), 0);
}

function countMdastThematicBreaks(node: unknown): number {
  if (typeof node !== "object" || node === null) {
    return 0;
  }
  if (Reflect.get(node, "type") === "thematicBreak") {
    return 1;
  }
  const children = Reflect.get(node, "children");
  if (!Array.isArray(children)) {
    return 0;
  }
  return children.reduce(
    (count, child) => count + countMdastThematicBreaks(child),
    0,
  );
}

export const denotePlainTextPastePlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addComposerChild$]: DenotePlainTextPastePlugin,
      [addNestedEditorChild$]: DenotePlainTextPastePlugin,
      [addTableCellEditorChild$]: DenotePlainTextPastePlugin,
    });
  },
});

export const denoteThematicBreakShortcutPlugin = realmPlugin<{
  onInsert: (index: number) => void;
}>({
  init(realm, params) {
    const onInsert = params?.onInsert ?? (() => {});
    realm.pub(addComposerChild$, () => (
      <DenoteThematicBreakShortcut onInsert={onInsert} />
    ));
  },
});
