import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
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
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_DOWN_COMMAND,
  REDO_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  tokenizeRawText,
  UNDO_COMMAND,
} from "lexical";
import { useEffect } from "react";

interface PlainTextPasteOptions {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
}

interface SelectionSnapshot {
  nodes: SelectionNodeSnapshot[];
  selection: RangeSelection;
}

interface SelectionNodeSnapshot {
  childKeys: string[] | null;
  format: number | null;
  key: string;
  mode: string | null;
  parentKey: string | null;
  style: string | null;
  text: string;
  type: string;
}

function DenotePlainTextPastePlugin({
  readClipboardText,
  writeClipboardText,
  onError,
}: PlainTextPasteOptions) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let active = true;
    let contextSelection: SelectionSnapshot | null = null;
    const pasteAtSelection = (snapshot: SelectionSnapshot) => {
      void pastePlainText(
        editor,
        snapshot,
        readClipboardText,
        onError,
        () => active,
      );
    };
    const copyAtSelection = (
      snapshot: SelectionSnapshot,
      cut: boolean,
    ) => {
      void copyPlainText(
        editor,
        snapshot,
        cut,
        writeClipboardText,
        onError,
        () => active,
      );
    };
    const menuActions: RichTextContextMenuActions = {
      onCopy: () => {
        if (contextSelection) {
          copyAtSelection(contextSelection, false);
        }
      },
      onCut: () => {
        if (contextSelection) {
          copyAtSelection(contextSelection, true);
        }
      },
      onPaste: () => {
        if (contextSelection) {
          pasteAtSelection(contextSelection);
        }
      },
      onPastePlainText: () => {
        if (contextSelection) {
          pasteAtSelection(contextSelection);
        }
      },
      onRedo: () => {
        editor.dispatchCommand(REDO_COMMAND, undefined);
        editor.focus();
      },
      onSelectAll: () => {
        editor.update(() => {
          const root = $getRoot();
          root.select(0, root.getChildrenSize());
        });
        editor.focus();
      },
      onUndo: () => {
        editor.dispatchCommand(UNDO_COMMAND, undefined);
        editor.focus();
      },
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
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            event.preventDefault();
            pasteAtSelection(captureSelectionSnapshot(selection));
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const openContextMenu = (event: MouseEvent) => {
      if (!editor.isEditable() || !("__TAURI_INTERNALS__" in window)) {
        return;
      }
      const selection = editor.getEditorState().read(() => {
        const current = $getSelection();
        return $isRangeSelection(current)
          ? captureSelectionSnapshot(current)
          : null;
      });
      if (!selection) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      contextSelection = selection;
      activeRichTextContextMenuActions = menuActions;
      const position = new LogicalPosition(event.clientX, event.clientY);
      void getRichTextContextMenu()
        .then((menu) => menu.popup(position))
        .catch(onError);
    };
    const removeRootListener = editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("contextmenu", openContextMenu);
      root?.addEventListener("contextmenu", openContextMenu);
    });
    return () => {
      active = false;
      removeKeyDown();
      removeRootListener();
      if (activeRichTextContextMenuActions === menuActions) {
        activeRichTextContextMenuActions = null;
      }
    };
  }, [editor, onError, readClipboardText, writeClipboardText]);

  return null;
}

async function copyPlainText(
  editor: LexicalEditor,
  snapshot: SelectionSnapshot,
  cut: boolean,
  writeClipboardText: (text: string) => Promise<void>,
  onError: (error: unknown) => void,
  isActive: () => boolean,
) {
  try {
    assertCurrentSelectionSnapshot(
      editor,
      snapshot,
      cut ? "cut" : "copy",
    );
    const text = editor
      .getEditorState()
      .read(() => snapshot.selection.getTextContent());
    if (!text) {
      return;
    }
    await writeClipboardText(text);
    if (!isActive()) {
      return;
    }
    if (cut) {
      assertCurrentSelectionSnapshot(editor, snapshot, "cut");
      editor.update(
        () => {
          if (
            !$getNodeByKey(snapshot.selection.anchor.key) ||
            !$getNodeByKey(snapshot.selection.focus.key)
          ) {
            throw new Error(
              "Unable to cut because the editor selection is no longer available.",
            );
          }
          const restoredSelection = snapshot.selection.clone();
          $setSelection(restoredSelection);
          restoredSelection.removeText();
        },
        { discrete: true },
      );
    }
    editor.focus();
  } catch (caught) {
    onError(caught);
  }
}

async function pastePlainText(
  editor: LexicalEditor,
  snapshot: SelectionSnapshot,
  readClipboardText: () => Promise<string>,
  onError: (error: unknown) => void,
  isActive: () => boolean,
) {
  try {
    const text = await readClipboardText();
    if (!isActive()) {
      return;
    }
    assertCurrentSelectionSnapshot(editor, snapshot, "paste");
    editor.update(
      () => {
        if (
          !$getNodeByKey(snapshot.selection.anchor.key) ||
          !$getNodeByKey(snapshot.selection.focus.key)
        ) {
          throw new Error(
            "Unable to paste because the editor selection is no longer available.",
          );
        }
        $setSelection(snapshot.selection.clone());
        insertPlainText(text);
      },
      { discrete: true },
    );
    editor.focus();
  } catch (caught) {
    onError(caught);
  }
}

function assertCurrentSelectionSnapshot(
  editor: LexicalEditor,
  snapshot: SelectionSnapshot,
  action: "copy" | "cut" | "paste",
) {
  const unchanged = editor.getEditorState().read(() =>
    snapshot.nodes.every((expected) => {
      const node = $getNodeByKey(expected.key);
      return node ? selectionNodeMatches(node, expected) : false;
    }),
  );
  if (!unchanged) {
    throw new Error(
      `Unable to ${action} because the editor changed while reading the clipboard.`,
    );
  }
}

function captureSelectionSnapshot(
  selection: RangeSelection,
): SelectionSnapshot {
  const nodes = new Map<string, LexicalNode>();
  for (const node of [
    ...selection.getNodes(),
    selection.anchor.getNode(),
    selection.focus.getNode(),
  ]) {
    nodes.set(node.getKey(), node);
  }
  return {
    nodes: [...nodes.values()].map(captureSelectionNode),
    selection: selection.clone(),
  };
}

function captureSelectionNode(node: LexicalNode): SelectionNodeSnapshot {
  return {
    childKeys: $isElementNode(node)
      ? node.getChildren().map((child) => child.getKey())
      : null,
    format: $isTextNode(node) ? node.getFormat() : null,
    key: node.getKey(),
    mode: $isTextNode(node) ? node.getMode() : null,
    parentKey: node.getParent()?.getKey() ?? null,
    style: $isTextNode(node) ? node.getStyle() : null,
    text: node.getTextContent(),
    type: node.getType(),
  };
}

function selectionNodeMatches(
  node: LexicalNode,
  expected: SelectionNodeSnapshot,
): boolean {
  const current = captureSelectionNode(node);
  return (
    current.type === expected.type &&
    current.parentKey === expected.parentKey &&
    current.text === expected.text &&
    current.format === expected.format &&
    current.style === expected.style &&
    current.mode === expected.mode &&
    arraysEqual(current.childKeys, expected.childKeys)
  );
}

function arraysEqual(
  left: string[] | null,
  right: string[] | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]))
  );
}

function insertPlainText(text: string) {
  tokenizeRawText(text, {
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
    text: (part) => {
      const current = $getSelection();
      if ($isRangeSelection(current)) {
        current.insertText(part);
      }
    },
  });
}

interface RichTextContextMenuActions {
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onPastePlainText: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onUndo: () => void;
}

type RichTextContextMenuKind = "linux" | "native";

let activeRichTextContextMenuActions: RichTextContextMenuActions | null = null;
const richTextContextMenus: Partial<
  Record<RichTextContextMenuKind, Promise<Menu>>
> = {};

function getRichTextContextMenu(): Promise<Menu> {
  const kind: RichTextContextMenuKind = isLinux() ? "linux" : "native";
  const existing = richTextContextMenus[kind];
  if (existing) {
    return existing;
  }
  const created = createRichTextContextMenu(kind);
  richTextContextMenus[kind] = created;
  void created.catch(() => {
    if (richTextContextMenus[kind] === created) {
      delete richTextContextMenus[kind];
    }
  });
  return created;
}

async function createRichTextContextMenu(
  kind: RichTextContextMenuKind,
): Promise<Menu> {
  const invoke = (action: keyof RichTextContextMenuActions) => () => {
    activeRichTextContextMenuActions?.[action]();
  };
  const pasteWithoutFormatting = {
    text: "Paste without formatting",
    accelerator: "CmdOrCtrl+Shift+V",
    action: invoke("onPastePlainText"),
  };
  const items: NonNullable<MenuOptions["items"]> = kind === "linux"
    ? [
        {
          text: "Undo",
          accelerator: "CmdOrCtrl+Z",
          action: invoke("onUndo"),
        },
        {
          text: "Redo",
          accelerator: "CmdOrCtrl+Shift+Z",
          action: invoke("onRedo"),
        },
        { item: "Separator" },
        {
          text: "Cut",
          accelerator: "CmdOrCtrl+X",
          action: invoke("onCut"),
        },
        {
          text: "Copy",
          accelerator: "CmdOrCtrl+C",
          action: invoke("onCopy"),
        },
        {
          text: "Paste",
          accelerator: "CmdOrCtrl+V",
          action: invoke("onPaste"),
        },
        pasteWithoutFormatting,
        { item: "Separator" },
        {
          text: "Select All",
          accelerator: "CmdOrCtrl+A",
          action: invoke("onSelectAll"),
        },
      ]
    : [
        { item: "Undo" },
        { item: "Redo" },
        { item: "Separator" },
        { item: "Cut" },
        { item: "Copy" },
        { item: "Paste" },
        pasteWithoutFormatting,
        { item: "Separator" },
        { item: "SelectAll" },
      ];
  return Menu.new({ items });
}

function isLinux(): boolean {
  return /\bLinux\b/i.test(navigator.userAgent);
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

export const denotePlainTextPastePlugin = realmPlugin<PlainTextPasteOptions>({
  init(realm, params) {
    if (!params) {
      return;
    }
    const PlainTextPastePlugin = () => (
      <DenotePlainTextPastePlugin
        readClipboardText={params.readClipboardText}
        writeClipboardText={params.writeClipboardText}
        onError={params.onError}
      />
    );
    realm.pubIn({
      [addComposerChild$]: PlainTextPastePlugin,
      [addNestedEditorChild$]: PlainTextPastePlugin,
      [addTableCellEditorChild$]: PlainTextPastePlugin,
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
