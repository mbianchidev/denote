import {
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  PluginKanbanBoardModel,
  PluginKanbanBoardRequest,
  PluginKanbanCard,
  PluginKanbanEdit,
  PluginKanbanEditRequest,
  PluginKanbanEditResult,
} from "@denote/plugin-sdk";

type DraggedItem =
  | {
      kind: "column";
      id: string;
    }
  | {
      kind: "card";
      id: string;
    };

type PointerDropTarget =
  | {
      kind: "column";
      beforeColumnId: string | null;
      position: number;
      key: string;
    }
  | {
      kind: "card";
      columnId: string;
      beforeCardId: string | null;
      position: number;
      key: string;
    };

interface PointerDragSession {
  item: DraggedItem;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

export const KANBAN_CARD_PREVIEW_LINES = 5;

type EditorState =
  | {
      kind: "board-title";
      title: string;
    }
  | {
      kind: "add-column";
      title: string;
    }
  | {
      kind: "rename-column";
      columnId: string;
      title: string;
    }
  | {
      kind: "add-card";
      columnId: string;
      title: string;
      body: string;
      focus: "title";
    }
  | {
      kind: "edit-card";
      columnId: string;
      cardId: string;
      title: string;
      body: string;
      focus: "title" | "body";
    }
  | {
      kind: "delete-column";
      columnId: string;
      title: string;
      cardCount: number;
    }
  | {
      kind: "delete-card";
      columnId: string;
      cardId: string;
      title: string;
    }
  | null;

interface KanbanBoardEditorProps {
  title: string;
  path: string;
  source: string;
  readOnly: boolean;
  parse: (
    request: PluginKanbanBoardRequest,
  ) => Promise<PluginKanbanBoardModel>;
  edit: (
    request: PluginKanbanEditRequest,
  ) => Promise<PluginKanbanEditResult>;
  onChange: (source: string) => void;
  onLinkOpen: (href: string, label: string) => void;
  onError: (error: unknown) => void;
}

export function KanbanBoardEditor({
  title,
  path,
  source,
  readOnly,
  parse,
  edit,
  onChange,
  onLinkOpen,
  onError,
}: KanbanBoardEditorProps) {
  const [model, setModel] = useState<PluginKanbanBoardModel | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [grabbedItem, setGrabbedItem] = useState<DraggedItem | null>(null);
  const [pointerDragging, setPointerDragging] = useState<DraggedItem | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [initializeTitle, setInitializeTitle] = useState(() =>
    defaultBoardTitle(path),
  );
  const [initialColumnTitle, setInitialColumnTitle] = useState("Backlog");
  const parseRequest = useRef(0);
  const parseRef = useRef(parse);
  const editRef = useRef(edit);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const currentPathRef = useRef(path);
  const currentSourceRef = useRef(source);
  const mountedRef = useRef(true);
  const lastAppliedSource = useRef<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const editorFocus = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  const pointerDrag = useRef<PointerDragSession | null>(null);
  const pointerDropTarget = useRef<PointerDropTarget | null>(null);
  const focusTargets = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterUpdate = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  parseRef.current = parse;
  editRef.current = edit;
  onChangeRef.current = onChange;
  onErrorRef.current = onError;
  currentPathRef.current = path;
  currentSourceRef.current = source;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      parseRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    if (lastAppliedSource.current === source) {
      lastAppliedSource.current = null;
      return;
    }
    const current = ++parseRequest.current;
    const timer = window.setTimeout(() => {
      void parseRef.current({ path, source })
        .then((next) => {
          if (parseRequest.current !== current) {
            return;
          }
          setModel(next);
          setParseError(null);
        })
        .catch((error) => {
          if (parseRequest.current !== current) {
            return;
          }
          setModel(null);
          setParseError(error instanceof Error ? error.message : String(error));
        });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      parseRequest.current += 1;
    };
  }, [path, source]);

  const editorSession = editorSessionKey(editor);
  useEffect(() => {
    editorFocus.current?.focus();
  }, [editorSession]);

  useLayoutEffect(() => {
    const key = focusAfterUpdate.current;
    if (!key) {
      return;
    }
    focusAfterUpdate.current = null;
    focusTargets.current.get(key)?.focus();
  }, [focusRequest, model]);

  const rememberTrigger = (element: HTMLElement) => {
    returnFocus.current = element;
  };

  const closeEditor = () => {
    setEditor(null);
    window.setTimeout(() => returnFocus.current?.focus(), 0);
  };

  const registerFocusTarget =
    (key: string) => (element: HTMLButtonElement | null) => {
      if (element) {
        focusTargets.current.set(key, element);
      } else {
        focusTargets.current.delete(key);
      }
    };

  const performEdit = async (
    operation: PluginKanbanEdit,
    message: string,
    focusKey?: string | ((next: PluginKanbanBoardModel) => string | null),
  ) => {
    if (readOnly || busy) {
      return;
    }
    setBusy(true);
    parseRequest.current += 1;
    const expectedPath = path;
    const expectedSource = source;
    try {
      const result = await editRef.current({
        path: expectedPath,
        source: expectedSource,
        edit: operation,
      });
      if (!mountedRef.current) {
        return;
      }
      if (
        currentPathRef.current !== expectedPath ||
        currentSourceRef.current !== expectedSource
      ) {
        throw new Error(
          "The Kanban board changed before this edit completed. Try again.",
        );
      }
      lastAppliedSource.current = result.source;
      setModel(result.model);
      setParseError(null);
      setEditor(null);
      setAnnouncement(message);
      const nextFocus =
        typeof focusKey === "function" ? focusKey(result.model) : focusKey;
      if (nextFocus) {
        focusAfterUpdate.current = nextFocus;
        setFocusRequest((current) => current + 1);
      }
      onChangeRef.current(result.source);
    } catch (error) {
      if (mountedRef.current) {
        onErrorRef.current(error);
        setAnnouncement(
          error instanceof Error ? error.message : "Kanban board edit failed.",
        );
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  const moveColumn = (columnId: string, targetIndex: number) => {
    if (!model) {
      return;
    }
    const without = model.columns.filter((column) => column.id !== columnId);
    const bounded = Math.max(0, Math.min(without.length, targetIndex));
    const beforeColumnId = without[bounded]?.id ?? null;
    void performEdit(
      { type: "move-column", columnId, beforeColumnId },
      `Moved column ${columnTitle(model, columnId)} to position ${bounded + 1}`,
      `column:${columnId}`,
    );
  };

  const moveColumnBefore = (
    columnId: string,
    beforeColumnId: string,
    position: number,
  ) => {
    if (!model) {
      return;
    }
    void performEdit(
      { type: "move-column", columnId, beforeColumnId },
      `Moved column ${columnTitle(model, columnId)} to position ${position}`,
      `column:${columnId}`,
    );
  };

  const moveCard = (
    cardId: string,
    targetColumnId: string,
    targetIndex: number,
  ) => {
    if (!model) {
      return;
    }
    const target = model.columns.find(
      (column) => column.id === targetColumnId,
    );
    if (!target) {
      return;
    }
    const without = target.cards.filter((card) => card.id !== cardId);
    const bounded = Math.max(0, Math.min(without.length, targetIndex));
    const beforeCardId = without[bounded]?.id ?? null;
    void performEdit(
      { type: "move-card", cardId, targetColumnId, beforeCardId },
      `Moved card ${cardTitle(model, cardId)} to ${target.title}, position ${bounded + 1}`,
      `card:${cardId}`,
    );
  };

  const moveCardBefore = (
    cardId: string,
    targetColumnId: string,
    beforeCardId: string,
    position: number,
  ) => {
    if (!model) {
      return;
    }
    const target = model.columns.find(
      (column) => column.id === targetColumnId,
    );
    if (!target) {
      return;
    }
    void performEdit(
      { type: "move-card", cardId, targetColumnId, beforeCardId },
      `Moved card ${cardTitle(model, cardId)} to ${target.title}, position ${position}`,
      `card:${cardId}`,
    );
  };

  const startPointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: DraggedItem,
  ) => {
    if (readOnly || busy || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.focus();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pointerDrag.current = {
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    pointerDropTarget.current = null;
    setGrabbedItem(null);
  };

  const updatePointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const session = pointerDrag.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(
      event.clientX - session.startX,
      event.clientY - session.startY,
    );
    if (!session.active && distance < 5) {
      return;
    }
    event.preventDefault();
    if (!session.active) {
      session.active = true;
      setPointerDragging(session.item);
    }
    const target = pointerTarget(
      boardRef.current,
      session.item,
      event.clientX,
      event.clientY,
    );
    pointerDropTarget.current = target;
    setDropTarget(target?.key ?? null);
  };

  const finishPointerDrag = () => {
    pointerDrag.current = null;
    pointerDropTarget.current = null;
    setPointerDragging(null);
    setDropTarget(null);
  };

  const completePointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const session = pointerDrag.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    const target =
      session.active &&
      (pointerTarget(
        boardRef.current,
        session.item,
        event.clientX,
        event.clientY,
      ) ??
        pointerDropTarget.current);
    if (
      typeof event.currentTarget.releasePointerCapture === "function" &&
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishPointerDrag();
    if (!target) {
      return;
    }
    if (target.kind === "column" && session.item.kind === "column") {
      if (target.beforeColumnId) {
        moveColumnBefore(
          session.item.id,
          target.beforeColumnId,
          target.position,
        );
      } else {
        moveColumn(session.item.id, model?.columns.length ?? 0);
      }
    } else if (target.kind === "card" && session.item.kind === "card") {
      if (target.beforeCardId) {
        moveCardBefore(
          session.item.id,
          target.columnId,
          target.beforeCardId,
          target.position,
        );
      } else {
        const column = model?.columns.find(
          (candidate) => candidate.id === target.columnId,
        );
        moveCard(
          session.item.id,
          target.columnId,
          column?.cards.length ?? 0,
        );
      }
    }
  };

  const toggleKeyboardGrab = (item: DraggedItem, label: string) => {
    const grabbed =
      grabbedItem?.kind === item.kind && grabbedItem.id === item.id;
    setGrabbedItem(grabbed ? null : item);
    setAnnouncement(
      grabbed
        ? `Dropped ${label}`
        : `Picked up ${label}. Use arrow keys to move it, then press Space to drop.`,
    );
  };

  const onColumnReorderKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    columnId: string,
    columnTitle: string,
    columnIndex: number,
  ) => {
    if (!model) {
      return;
    }
    const item: DraggedItem = { kind: "column", id: columnId };
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleKeyboardGrab(item, `column ${columnTitle}`);
      return;
    }
    const grabbed =
      grabbedItem?.kind === "column" && grabbedItem.id === columnId;
    if (!grabbed) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setGrabbedItem(null);
      setAnnouncement(`Cancelled moving column ${columnTitle}`);
    } else if (event.key === "ArrowLeft" && columnIndex > 0) {
      event.preventDefault();
      moveColumn(columnId, columnIndex - 1);
    } else if (
      event.key === "ArrowRight" &&
      columnIndex < model.columns.length - 1
    ) {
      event.preventDefault();
      moveColumn(columnId, columnIndex + 1);
    } else if (event.key === "Home" && columnIndex > 0) {
      event.preventDefault();
      moveColumn(columnId, 0);
    } else if (
      event.key === "End" &&
      columnIndex < model.columns.length - 1
    ) {
      event.preventDefault();
      moveColumn(columnId, model.columns.length - 1);
    }
  };

  const onCardReorderKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    card: PluginKanbanCard,
    cardIndex: number,
    columnIndex: number,
  ) => {
    if (!model) {
      return;
    }
    const column = model.columns[columnIndex];
    const item: DraggedItem = { kind: "card", id: card.id };
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleKeyboardGrab(item, `card ${card.title}`);
      return;
    }
    const grabbed =
      grabbedItem?.kind === "card" && grabbedItem.id === card.id;
    if (!grabbed) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setGrabbedItem(null);
      setAnnouncement(`Cancelled moving card ${card.title}`);
    } else if (event.key === "ArrowUp" && cardIndex > 0) {
      event.preventDefault();
      moveCard(card.id, column.id, cardIndex - 1);
    } else if (
      event.key === "ArrowDown" &&
      cardIndex < column.cards.length - 1
    ) {
      event.preventDefault();
      moveCard(card.id, column.id, cardIndex + 1);
    } else if (event.key === "ArrowLeft" && columnIndex > 0) {
      event.preventDefault();
      const previous = model.columns[columnIndex - 1];
      moveCard(card.id, previous.id, previous.cards.length);
    } else if (
      event.key === "ArrowRight" &&
      columnIndex < model.columns.length - 1
    ) {
      event.preventDefault();
      const next = model.columns[columnIndex + 1];
      moveCard(card.id, next.id, next.cards.length);
    } else if (event.key === "Home" && cardIndex > 0) {
      event.preventDefault();
      moveCard(card.id, column.id, 0);
    } else if (
      event.key === "End" &&
      cardIndex < column.cards.length - 1
    ) {
      event.preventDefault();
      moveCard(card.id, column.id, column.cards.length - 1);
    }
  };

  const parseFailure =
    model?.error ?? (parseError ? { message: parseError } : null);
  const boardHeadingId = `kanban-board-${safeDomId(path)}`;

  if (parseFailure) {
    return (
      <section
        className="kanban-board-editor"
        aria-label={title}
        aria-busy={busy}
      >
        <div className="kanban-board-editor__error" role="alert">
          <strong>Board view unavailable.</strong>
          <span>{parseFailure.message}</span>
          {parseFailure.line ? <span>Line {parseFailure.line}</span> : null}
          <span>Switch to Markdown to inspect and repair the exact source.</span>
        </div>
      </section>
    );
  }

  if (model?.canInitialize) {
    return (
      <section
        className="kanban-board-editor kanban-board-editor--empty"
        aria-label={title}
        aria-busy={busy}
      >
        <form
          className="kanban-board-editor__initialize"
          onSubmit={(event) => {
            event.preventDefault();
            void performEdit(
              {
                type: "initialize",
                title: initializeTitle,
                initialColumnTitle,
              },
              `Initialized ${initializeTitle}`,
              "board",
            );
          }}
        >
          <div>
            <span className="dialog-kicker">Portable Markdown</span>
            <h2>Initialize Kanban board</h2>
            <p>
              Denote appends the board after existing Markdown and preserves
              that content.
            </p>
          </div>
          {model.notices.map((notice) => (
            <p key={notice} className="kanban-board-editor__notice" role="note">
              {notice}
            </p>
          ))}
          <label>
            Board title
            <input
              ref={(element) => {
                editorFocus.current = element;
              }}
              value={initializeTitle}
              onChange={(event) => setInitializeTitle(event.currentTarget.value)}
              disabled={readOnly || busy}
              required
            />
          </label>
          <label>
            First column
            <input
              value={initialColumnTitle}
              onChange={(event) =>
                setInitialColumnTitle(event.currentTarget.value)
              }
              disabled={readOnly || busy}
              required
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={
              readOnly ||
              busy ||
              initializeTitle.trim().length === 0 ||
              initialColumnTitle.trim().length === 0
            }
          >
            Initialize board
          </button>
        </form>
      </section>
    );
  }

  if (!model) {
    return (
      <section className="kanban-board-editor" aria-label={title} aria-busy="true">
        <div className="kanban-board-editor__loading" role="status">
          Loading board locally…
        </div>
      </section>
    );
  }

  return (
    <section
      ref={boardRef}
      className="kanban-board-editor"
      aria-labelledby={boardHeadingId}
      aria-busy={busy}
    >
      <header className="kanban-board-editor__header">
        {editor?.kind === "board-title" ? (
          <form
            className="kanban-inline-form kanban-inline-form--title"
            onSubmit={(event) => {
              event.preventDefault();
              void performEdit(
                { type: "rename-board", title: editor.title },
                `Renamed board to ${editor.title}`,
                "board",
              );
            }}
          >
            <label>
              Board title
              <input
                ref={(element) => {
                  editorFocus.current = element;
                }}
                value={editor.title}
                onChange={(event) =>
                  setEditor({ ...editor, title: event.currentTarget.value })
                }
                disabled={busy}
                required
              />
            </label>
            <InlineFormActions
              disabled={editor.title.trim().length === 0 || busy}
              onCancel={closeEditor}
              confirmLabel="Save title"
            />
          </form>
        ) : (
          <div className="kanban-board-editor__title">
            <div>
              <span className="dialog-kicker">Kanban board</span>
              <h1 id={boardHeadingId}>
                <button
                  ref={registerFocusTarget("board")}
                  type="button"
                  className="kanban-title-button"
                  title="Edit board title"
                  disabled={readOnly || busy}
                  onClick={(event) => {
                    rememberTrigger(event.currentTarget);
                    setEditor({ kind: "board-title", title: model.title });
                  }}
                >
                  {model.title}
                </button>
              </h1>
            </div>
          </div>
        )}
        <div className="kanban-board-editor__toolbar">
          <span>
            {model.columns.length}{" "}
            {model.columns.length === 1 ? "column" : "columns"}
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={readOnly || busy}
            onClick={(event) => {
              rememberTrigger(event.currentTarget);
              setEditor({ kind: "add-column", title: "" });
            }}
          >
            <Plus aria-hidden="true" size={15} />
            Add column
          </button>
        </div>
        {editor?.kind === "add-column" ? (
          <form
            className="kanban-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const previousIds = new Set(
                model.columns.map((column) => column.id),
              );
              void performEdit(
                {
                  type: "add-column",
                  title: editor.title,
                  beforeColumnId: null,
                },
                `Added column ${editor.title}`,
                (next) => {
                  const added = next.columns.find(
                    (column) => !previousIds.has(column.id),
                  );
                  return added ? `column:${added.id}` : "board";
                },
              );
            }}
          >
            <label>
              New column title
              <input
                ref={(element) => {
                  editorFocus.current = element;
                }}
                value={editor.title}
                onChange={(event) =>
                  setEditor({ ...editor, title: event.currentTarget.value })
                }
                disabled={busy}
                required
              />
            </label>
            <InlineFormActions
              disabled={editor.title.trim().length === 0 || busy}
              onCancel={closeEditor}
              confirmLabel="Add column"
            />
          </form>
        ) : null}
      </header>

      <ol className="kanban-board-editor__columns" aria-label="Board columns">
        {model.columns.map((column, columnIndex) => (
          <Fragment key={column.id}>
            <li
              className="kanban-column-drop-zone"
              data-active={dropTarget === `column-slot:${column.id}`}
              aria-hidden="true"
            />
            <li
              className="kanban-column"
              data-kanban-column-id={column.id}
              data-grabbed={
                grabbedItem?.kind === "column" &&
                grabbedItem.id === column.id
              }
              data-dragging={
                pointerDragging?.kind === "column" &&
                pointerDragging.id === column.id
              }
            >
              <section
                aria-labelledby={`kanban-column-${safeDomId(column.id)}`}
              >
              <header className="kanban-column__header">
                <button
                  ref={registerFocusTarget(`column:${column.id}`)}
                  type="button"
                  className="kanban-drag-handle"
                  aria-label={`Reorder column ${column.title}`}
                  aria-pressed={
                    grabbedItem?.kind === "column" &&
                    grabbedItem.id === column.id
                  }
                  title="Drag to reorder. Press Space, then use Left or Right."
                  disabled={readOnly || busy}
                  onPointerDown={(event) =>
                    startPointerDrag(event, {
                      kind: "column",
                      id: column.id,
                    })
                  }
                  onPointerMove={updatePointerDrag}
                  onPointerUp={completePointerDrag}
                  onPointerCancel={finishPointerDrag}
                  onKeyDown={(event) =>
                    onColumnReorderKeyDown(
                      event,
                      column.id,
                      column.title,
                      columnIndex,
                    )
                  }
                >
                  <GripVertical aria-hidden="true" size={15} />
                </button>
                {editor?.kind === "rename-column" &&
                editor.columnId === column.id ? (
                  <form
                    className="kanban-inline-form kanban-inline-form--compact"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void performEdit(
                        {
                          type: "rename-column",
                          columnId: column.id,
                          title: editor.title,
                        },
                        `Renamed column to ${editor.title}`,
                        `column:${column.id}`,
                      );
                    }}
                  >
                    <label>
                      Column title
                      <input
                        ref={(element) => {
                          editorFocus.current = element;
                        }}
                        value={editor.title}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            title: event.currentTarget.value,
                          })
                        }
                        disabled={busy}
                        required
                      />
                    </label>
                    <InlineFormActions
                      disabled={editor.title.trim().length === 0 || busy}
                      onCancel={closeEditor}
                      confirmLabel="Save"
                    />
                  </form>
                ) : (
                  <>
                    <div className="kanban-column__title">
                      <h2 id={`kanban-column-${safeDomId(column.id)}`}>
                        <button
                          type="button"
                          className="kanban-title-button"
                          title={`Rename ${column.title}`}
                          disabled={readOnly || busy}
                          onClick={(event) => {
                            rememberTrigger(event.currentTarget);
                            setEditor({
                              kind: "rename-column",
                              columnId: column.id,
                              title: column.title,
                            });
                          }}
                        >
                          {column.title}
                        </button>
                      </h2>
                      <span>
                        {column.cards.length}{" "}
                        {column.cards.length === 1 ? "card" : "cards"}
                      </span>
                    </div>
                    <div className="kanban-item-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title={`Delete ${column.title}`}
                        aria-label={`Delete ${column.title}`}
                        disabled={readOnly || busy}
                        onClick={(event) => {
                          rememberTrigger(event.currentTarget);
                          setEditor({
                            kind: "delete-column",
                            columnId: column.id,
                            title: column.title,
                            cardCount: column.cards.length,
                          });
                        }}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                  </>
                )}
              </header>

              {editor?.kind === "delete-column" &&
              editor.columnId === column.id ? (
                <DeleteConfirmation
                  focusRef={(element) => {
                    editorFocus.current = element;
                  }}
                  message={`Delete ${editor.title} and ${editor.cardCount} ${
                    editor.cardCount === 1 ? "card" : "cards"
                  }?`}
                  onCancel={closeEditor}
                  onDelete={() => {
                    const next =
                      model.columns[columnIndex + 1] ??
                      model.columns[columnIndex - 1];
                    void performEdit(
                      {
                        type: "delete-column",
                        columnId: column.id,
                      },
                      `Deleted column ${column.title}`,
                      next ? `column:${next.id}` : "board",
                    );
                  }}
                  disabled={busy}
                />
              ) : null}

              <ol
                className="kanban-column__cards"
                aria-label={`${column.title} cards`}
              >
                {column.cards.map((card, cardIndex) => (
                  <Fragment key={card.id}>
                    <li
                      className="kanban-drop-zone"
                      data-active={
                        dropTarget ===
                        `card-slot:${column.id}:${card.id}`
                      }
                      aria-hidden="true"
                    />
                    <li
                      className="kanban-card"
                      data-kanban-card-id={card.id}
                      data-grabbed={
                        grabbedItem?.kind === "card" &&
                        grabbedItem.id === card.id
                      }
                      data-dragging={
                        pointerDragging?.kind === "card" &&
                        pointerDragging.id === card.id
                      }
                    >
                    {editor?.kind === "edit-card" &&
                    editor.cardId === card.id ? (
                      <CardForm
                        editor={editor}
                        busy={busy}
                        focusRef={(element) => {
                          editorFocus.current = element;
                        }}
                        onChange={setEditor}
                        onCancel={closeEditor}
                        onSubmit={() =>
                          void performEdit(
                            {
                              type: "edit-card",
                              cardId: card.id,
                              title: editor.title,
                              body: editor.body,
                            },
                            `Updated card ${editor.title}`,
                            `card:${card.id}`,
                          )
                        }
                      />
                    ) : (
                      <article>
                        <header className="kanban-card__header">
                          <button
                            ref={registerFocusTarget(`card:${card.id}`)}
                            type="button"
                            className="kanban-drag-handle"
                            aria-label={`Reorder card ${card.title}`}
                            aria-pressed={
                              grabbedItem?.kind === "card" &&
                              grabbedItem.id === card.id
                            }
                            title="Drag to move. Press Space, then use arrow keys."
                            disabled={readOnly || busy}
                            onPointerDown={(event) =>
                              startPointerDrag(event, {
                                kind: "card",
                                id: card.id,
                              })
                            }
                            onPointerMove={updatePointerDrag}
                            onPointerUp={completePointerDrag}
                            onPointerCancel={finishPointerDrag}
                            onKeyDown={(event) =>
                              onCardReorderKeyDown(
                                event,
                                card,
                                cardIndex,
                                columnIndex,
                              )
                            }
                          >
                            <GripVertical aria-hidden="true" size={14} />
                          </button>
                          <h3>
                            <button
                              type="button"
                              className="kanban-title-button"
                              title={`Rename ${card.title}`}
                              disabled={readOnly || busy}
                              onClick={(event) => {
                                rememberTrigger(event.currentTarget);
                                setEditor({
                                  kind: "edit-card",
                                  columnId: column.id,
                                  cardId: card.id,
                                  title: card.title,
                                  body: card.body,
                                  focus: "title",
                                });
                              }}
                            >
                              {card.title}
                            </button>
                          </h3>
                        </header>
                        <button
                          type="button"
                          className={
                            card.body
                              ? "kanban-card__body"
                              : "kanban-card__body kanban-card__empty"
                          }
                          title={`Open and edit details for ${card.title}`}
                          aria-label={`Open and edit details for ${card.title}`}
                          style={{
                            WebkitLineClamp: KANBAN_CARD_PREVIEW_LINES,
                          }}
                          disabled={readOnly || busy}
                          onClick={(event) => {
                            rememberTrigger(event.currentTarget);
                            setEditor({
                              kind: "edit-card",
                              columnId: column.id,
                              cardId: card.id,
                              title: card.title,
                              body: card.body,
                              focus: "body",
                            });
                          }}
                        >
                          {card.body || "No details"}
                        </button>
                        <CardMetadata
                          card={card}
                          onLinkOpen={onLinkOpen}
                        />
                        <div
                          className="kanban-item-actions kanban-card__actions"
                          aria-label={`Actions for ${card.title}`}
                        >
                          <button
                            type="button"
                            className="icon-button"
                            title={`Delete ${card.title}`}
                            aria-label={`Delete ${card.title}`}
                            disabled={readOnly || busy}
                            onClick={(event) => {
                              rememberTrigger(event.currentTarget);
                              setEditor({
                                kind: "delete-card",
                                columnId: column.id,
                                cardId: card.id,
                                title: card.title,
                              });
                            }}
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        </div>
                      </article>
                    )}
                    {editor?.kind === "delete-card" &&
                    editor.cardId === card.id ? (
                      <DeleteConfirmation
                        focusRef={(element) => {
                          editorFocus.current = element;
                        }}
                        message={`Delete ${editor.title}?`}
                        onCancel={closeEditor}
                        onDelete={() => {
                          const next =
                            column.cards[cardIndex + 1] ??
                            column.cards[cardIndex - 1];
                          void performEdit(
                            { type: "delete-card", cardId: card.id },
                            `Deleted card ${card.title}`,
                            next
                              ? `card:${next.id}`
                              : `column-add:${column.id}`,
                          );
                        }}
                        disabled={busy}
                      />
                    ) : null}
                    </li>
                  </Fragment>
                ))}
                <li
                  className="kanban-drop-zone"
                  data-active={
                    dropTarget === `card-slot:${column.id}:end`
                  }
                  aria-hidden="true"
                />
              </ol>

              {editor?.kind === "add-card" &&
              editor.columnId === column.id ? (
                <CardForm
                  editor={editor}
                  busy={busy}
                  focusRef={(element) => {
                    editorFocus.current = element;
                  }}
                  onChange={setEditor}
                  onCancel={closeEditor}
                  onSubmit={() => {
                    const previousIds = new Set(
                      model.columns.flatMap((candidate) =>
                        candidate.cards.map((card) => card.id),
                      ),
                    );
                    void performEdit(
                      {
                        type: "add-card",
                        columnId: column.id,
                        title: editor.title,
                        body: editor.body,
                        beforeCardId: null,
                      },
                      `Added card ${editor.title} to ${column.title}`,
                      (next) => {
                        const added = next.columns
                          .flatMap((candidate) => candidate.cards)
                          .find((card) => !previousIds.has(card.id));
                        return added
                          ? `card:${added.id}`
                          : `column-add:${column.id}`;
                      },
                    );
                  }}
                />
              ) : (
                <button
                  ref={registerFocusTarget(`column-add:${column.id}`)}
                  type="button"
                  className="kanban-column__add-card"
                  aria-label={`Add card to ${column.title}`}
                  disabled={readOnly || busy}
                  onClick={(event) => {
                    rememberTrigger(event.currentTarget);
                    setEditor({
                      kind: "add-card",
                      columnId: column.id,
                      title: "",
                      body: "",
                      focus: "title",
                    });
                  }}
                >
                  <Plus aria-hidden="true" size={15} />
                  Add card
                </button>
              )}
            </section>
            </li>
          </Fragment>
        ))}
        <li
          className="kanban-column-drop-zone"
          data-active={dropTarget === "column-slot:end"}
          aria-hidden="true"
        />
      </ol>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>
  );
}

function InlineFormActions({
  disabled,
  onCancel,
  confirmLabel,
}: {
  disabled: boolean;
  onCancel: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="kanban-inline-form__actions">
      <button type="button" className="secondary-button" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="primary-button" disabled={disabled}>
        {confirmLabel}
      </button>
    </div>
  );
}

function CardForm({
  editor,
  busy,
  focusRef,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: Extract<EditorState, { kind: "add-card" | "edit-card" }>;
  busy: boolean;
  focusRef: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onChange: (editor: EditorState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="kanban-inline-form kanban-card-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        Card title
        <input
          ref={editor.focus === "title" ? focusRef : undefined}
          value={editor.title}
          onChange={(event) =>
            onChange({ ...editor, title: event.currentTarget.value })
          }
          disabled={busy}
          required
        />
      </label>
      <label>
        Card details (Markdown)
        <textarea
          ref={editor.focus === "body" ? focusRef : undefined}
          value={editor.body}
          onChange={(event) =>
            onChange({ ...editor, body: event.currentTarget.value })
          }
          disabled={busy}
          rows={6}
          placeholder="Link notes with [Title](Note.md) and add #tags."
        />
      </label>
      <InlineFormActions
        disabled={editor.title.trim().length === 0 || busy}
        onCancel={onCancel}
        confirmLabel={editor.kind === "add-card" ? "Add card" : "Save card"}
      />
    </form>
  );
}

const DeleteConfirmation = ({
  focusRef,
  message,
  onCancel,
  onDelete,
  disabled,
}: {
  focusRef: (element: HTMLButtonElement | null) => void;
  message: string;
  onCancel: () => void;
  onDelete: () => void;
  disabled: boolean;
}) => (
  <div className="kanban-delete-confirmation" role="group" aria-label={message}>
    <p>{message}</p>
    <div>
      <button
        ref={focusRef}
        type="button"
        className="secondary-button"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        className="danger-button"
        onClick={onDelete}
        disabled={disabled}
      >
        Delete
      </button>
    </div>
  </div>
);

function CardMetadata({
  card,
  onLinkOpen,
}: {
  card: PluginKanbanCard;
  onLinkOpen: (href: string, label: string) => void;
}) {
  if (card.tags.length === 0 && card.links.length === 0) {
    return null;
  }
  return (
    <div className="kanban-card__metadata">
      {card.tags.length > 0 ? (
        <ul className="kanban-card__tags" aria-label={`Tags for ${card.title}`}>
          {card.tags.map((tag) => (
            <li key={tag}>#{tag}</li>
          ))}
        </ul>
      ) : null}
      {card.links.length > 0 ? (
        <ul className="kanban-card__links" aria-label={`Links for ${card.title}`}>
          {card.links.map((link) => (
            <li key={`${link.label}\u0000${link.href}`}>
              <button
                type="button"
                className="text-button"
                onClick={() => onLinkOpen(link.href, link.label)}
              >
                {link.label || link.href}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function columnTitle(model: PluginKanbanBoardModel, columnId: string): string {
  return (
    model.columns.find((column) => column.id === columnId)?.title ?? "column"
  );
}

function cardTitle(model: PluginKanbanBoardModel, cardId: string): string {
  for (const column of model.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return card.title;
    }
  }
  return "card";
}

function editorSessionKey(editor: EditorState): string {
  if (!editor) {
    return "";
  }
  switch (editor.kind) {
    case "board-title":
    case "add-column":
      return editor.kind;
    case "rename-column":
    case "delete-column":
      return `${editor.kind}:${editor.columnId}`;
    case "add-card":
      return `${editor.kind}:${editor.columnId}:${editor.focus}`;
    case "edit-card":
      return `${editor.kind}:${editor.cardId}:${editor.focus}`;
    case "delete-card":
      return `${editor.kind}:${editor.cardId}`;
  }
}

function defaultBoardTitle(path: string): string {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "Board";
  return (
    name
      .replace(/\.kanban\.(?:md|markdown)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Board"
  );
}

function safeDomId(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-");
}

function pointerTarget(
  root: HTMLElement | null,
  item: DraggedItem,
  clientX: number,
  clientY: number,
): PointerDropTarget | null {
  if (!root) {
    return null;
  }
  const board = root.querySelector<HTMLElement>(
    ".kanban-board-editor__columns",
  );
  if (!board) {
    return null;
  }
  const boardRect = board.getBoundingClientRect();
  if (
    clientX < boardRect.left ||
    clientX > boardRect.right ||
    clientY < boardRect.top ||
    clientY > boardRect.bottom
  ) {
    return null;
  }
  const columns = Array.from(
    root.querySelectorAll<HTMLElement>("[data-kanban-column-id]"),
  );
  if (item.kind === "column") {
    const remaining = columns.filter(
      (column) => column.dataset.kanbanColumnId !== item.id,
    );
    const beforeIndex = remaining.findIndex((column) => {
      const rect = column.getBoundingClientRect();
      return clientX < rect.left + rect.width / 2;
    });
    const before =
      beforeIndex >= 0
        ? remaining[beforeIndex]?.dataset.kanbanColumnId ?? null
        : null;
    return {
      kind: "column",
      beforeColumnId: before,
      position: beforeIndex >= 0 ? beforeIndex + 1 : remaining.length + 1,
      key: before ? `column-slot:${before}` : "column-slot:end",
    };
  }

  const targetColumn =
    columns.find((column) => {
      const rect = column.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right;
    }) ??
    columns.reduce<HTMLElement | null>((nearest, column) => {
      if (!nearest) {
        return column;
      }
      const columnRect = column.getBoundingClientRect();
      const nearestRect = nearest.getBoundingClientRect();
      return Math.abs(clientX - (columnRect.left + columnRect.width / 2)) <
        Math.abs(clientX - (nearestRect.left + nearestRect.width / 2))
        ? column
        : nearest;
    }, null);
  const columnId = targetColumn?.dataset.kanbanColumnId;
  if (!targetColumn || !columnId) {
    return null;
  }
  const cards = Array.from(
    targetColumn.querySelectorAll<HTMLElement>("[data-kanban-card-id]"),
  ).filter((card) => card.dataset.kanbanCardId !== item.id);
  const beforeIndex = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  const before =
    beforeIndex >= 0
      ? cards[beforeIndex]?.dataset.kanbanCardId ?? null
      : null;
  return {
    kind: "card",
    columnId,
    beforeCardId: before,
    position: beforeIndex >= 0 ? beforeIndex + 1 : cards.length + 1,
    key: before
      ? `card-slot:${columnId}:${before}`
      : `card-slot:${columnId}:end`,
  };
}
