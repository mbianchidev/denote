import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginKanbanBoardModel,
  PluginKanbanEditRequest,
} from "@denote/plugin-sdk";
import {
  KANBAN_CARD_PREVIEW_LINES,
  KanbanBoardEditor,
} from "./KanbanBoardEditor";

const model: PluginKanbanBoardModel = {
  title: "Release board",
  columns: [
    {
      id: "column-backlog",
      title: "Backlog",
      cards: [
        {
          id: "card-spec",
          title: "Write specification",
          body: "See [Specification](Specification.md). #planning",
          tags: ["planning"],
          links: [
            {
              label: "Specification",
              href: "Specification.md",
            },
          ],
        },
        {
          id: "card-review",
          title: "Review change",
          body: "",
          tags: [],
          links: [],
        },
      ],
    },
    {
      id: "column-doing",
      title: "Doing",
      cards: [],
    },
  ],
  error: null,
  notices: [],
  canInitialize: false,
};

function renderBoard(options: {
  initialModel?: PluginKanbanBoardModel;
  edit?: (request: PluginKanbanEditRequest) => Promise<{
    source: string;
    model: PluginKanbanBoardModel;
  }>;
} = {}) {
  const onChange = vi.fn();
  const onLinkOpen = vi.fn();
  const onError = vi.fn();
  const parse = vi.fn(async () => options.initialModel ?? model);
  const edit =
    options.edit ??
    vi.fn(async () => ({
      source: "updated source",
      model: options.initialModel ?? model,
    }));
  const rendered = render(
    <KanbanBoardEditor
      title="Kanban boards"
      path="Release.kanban.md"
      source="synthetic source"
      readOnly={false}
      parse={parse}
      edit={edit}
      onChange={onChange}
      onLinkOpen={onLinkOpen}
      onError={onError}
    />,
  );
  return { ...rendered, edit, onChange, onLinkOpen, onError, parse };
}

describe("KanbanBoardEditor", () => {
  it("renders semantic columns, cards, tags, and host-opened note links", async () => {
    const user = userEvent.setup();
    const { onLinkOpen } = renderBoard();

    expect(
      await screen.findByRole("heading", { name: "Release board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Board columns" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Backlog cards" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Tags for Write specification" }),
    ).toHaveTextContent("#planning");

    await user.click(screen.getByRole("button", { name: "Specification" }));
    expect(onLinkOpen).toHaveBeenCalledWith(
      "Specification.md",
      "Specification",
    );
  });

  it("uses grip controls for pointer and keyboard movement without arrow buttons", async () => {
    const { container } = renderBoard();
    await screen.findByRole("heading", { name: "Release board" });

    expect(
      screen.getByRole("button", { name: "Reorder column Backlog" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Reorder card Write specification",
      }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /^Move / }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-pencil")).not.toBeInTheDocument();
  });

  it("moves a card across columns and restores focus to the moved card", async () => {
    const moved: PluginKanbanBoardModel = {
      ...model,
      columns: [
        {
          ...model.columns[0],
          cards: [model.columns[0].cards[1]],
        },
        {
          ...model.columns[1],
          cards: [model.columns[0].cards[0]],
        },
      ],
    };
    const edit = vi.fn(async () => ({
      source: "moved source",
      model: moved,
    }));
    renderBoard({ edit });

    const handle = await screen.findByRole("button", {
      name: "Reorder card Write specification",
    });
    handle.focus();
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(edit).toHaveBeenCalledWith({
      path: "Release.kanban.md",
      source: "synthetic source",
      edit: {
        type: "move-card",
        cardId: "card-spec",
        targetColumnId: "column-doing",
        beforeCardId: null,
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Reorder card Write specification",
        }),
      ).toHaveFocus(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved card Write specification to Doing",
    );
  });

  it("edits titles and bodies by clicking the text without moving focus while typing", async () => {
    const user = userEvent.setup();
    const { container } = renderBoard();

    await user.click(
      await screen.findByRole("button", {
        name: "Open and edit details for Write specification",
      }),
    );
    const body = screen.getByRole("textbox", {
      name: "Card details (Markdown)",
    });
    expect(body).toHaveFocus();
    await user.type(body, " more");
    expect(body).toHaveFocus();
    expect(
      screen.getByRole("textbox", { name: "Card title" }),
    ).not.toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Backlog" }));
    expect(
      screen.getByRole("textbox", { name: "Column title" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", { name: "Write specification" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Card title" }),
    ).toHaveFocus();
    expect(container.querySelector(".lucide-pencil")).not.toBeInTheDocument();
  });

  it("shows five body lines until the card is opened", async () => {
    const user = userEvent.setup();
    const body = Array.from(
      { length: 8 },
      (_, index) => `Detail line ${index + 1}`,
    ).join("\n");
    renderBoard({
      initialModel: {
        ...model,
        columns: [
          {
            ...model.columns[0],
            cards: [
              {
                ...model.columns[0].cards[0],
                body,
              },
            ],
          },
          model.columns[1],
        ],
      },
    });

    const preview = await screen.findByRole("button", {
      name: "Open and edit details for Write specification",
    });
    expect(preview).toHaveStyle({
      WebkitLineClamp: String(KANBAN_CARD_PREVIEW_LINES),
    });
    await user.click(preview);
    expect(
      screen.getByRole("textbox", {
        name: "Card details (Markdown)",
      }),
    ).toHaveValue(body);
  });

  it("adds cards through a focused inline Markdown form", async () => {
    const edit = vi.fn(async () => ({
      source: "added source",
      model: {
        ...model,
        columns: [
          {
            ...model.columns[0],
            cards: [
              ...model.columns[0].cards,
              {
                id: "card-new",
                title: "Publish notes",
                body: "[Release notes](Release.md) #release",
                tags: ["release"],
                links: [
                  {
                    label: "Release notes",
                    href: "Release.md",
                  },
                ],
              },
            ],
          },
          model.columns[1],
        ],
      },
    }));
    renderBoard({ edit });
    const user = userEvent.setup();

    await screen.findByRole("heading", { name: "Release board" });
    await user.click(
      screen.getByRole("button", { name: "Add card to Backlog" }),
    );
    const title = screen.getByRole("textbox", { name: "Card title" });
    expect(title).toHaveFocus();
    await user.type(title, "Publish notes");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Card details (Markdown)" }),
      {
        target: {
          value: "[Release notes](Release.md) #release",
        },
      },
    );
    await user.click(screen.getByRole("button", { name: "Add card" }));

    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          type: "add-card",
          columnId: "column-backlog",
          title: "Publish notes",
          body: "[Release notes](Release.md) #release",
          beforeCardId: null,
        },
      }),
    );
  });

  it("initializes an ordinary Markdown file without hiding preservation guidance", async () => {
    const initializable: PluginKanbanBoardModel = {
      title: "",
      columns: [],
      error: null,
      notices: ["Existing Markdown will remain above the board."],
      canInitialize: true,
    };
    const edit = vi.fn(async () => ({
      source: "initialized source",
      model,
    }));
    renderBoard({ initialModel: initializable, edit });
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { name: "Initialize Kanban board" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Existing Markdown will remain above the board.",
    );
    await user.click(screen.getByRole("button", { name: "Initialize board" }));
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          type: "initialize",
          title: "Release",
          initialColumnTitle: "Backlog",
        },
      }),
    );
  });

  it("supports pointer card dragging between columns", async () => {
    const moved: PluginKanbanBoardModel = {
      ...model,
      columns: [
        {
          ...model.columns[0],
          cards: [model.columns[0].cards[1]],
        },
        {
          ...model.columns[1],
          cards: [model.columns[0].cards[0]],
        },
      ],
    };
    const edit = vi.fn(async () => ({ source: "dragged source", model: moved }));
    const { container } = renderBoard({ edit });
    await screen.findByRole("heading", { name: "Release board" });
    const handle = screen.getByRole("button", {
      name: "Reorder card Write specification",
    });
    const doing = screen
      .getByRole("button", { name: "Doing" })
      .closest(".kanban-column") as HTMLElement;
    const board = container.querySelector<HTMLElement>(
      ".kanban-board-editor__columns",
    );
    const backlog = screen
      .getByRole("button", { name: "Backlog" })
      .closest(".kanban-column") as HTMLElement;
    mockRect(board!, 0, 0, 800, 600);
    mockRect(backlog!, 20, 20, 280, 520);
    mockRect(doing!, 320, 20, 280, 520);

    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 150,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 420,
      clientY: 300,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      clientX: 420,
      clientY: 300,
    });

    await act(async () => {});
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          type: "move-card",
          cardId: "card-spec",
          targetColumnId: "column-doing",
          beforeCardId: null,
        },
      }),
    );
    expect(container.querySelector(".lucide-arrow-left")).not.toBeInTheDocument();
  });

  it("reorders a card into any slot within the same column", async () => {
    const moved: PluginKanbanBoardModel = {
      ...model,
      columns: [
        {
          ...model.columns[0],
          cards: [model.columns[0].cards[1], model.columns[0].cards[0]],
        },
        model.columns[1],
      ],
    };
    const edit = vi.fn(async () => ({ source: "reordered source", model: moved }));
    const { container } = renderBoard({ edit });
    await screen.findByRole("heading", { name: "Release board" });
    const handle = screen.getByRole("button", {
      name: "Reorder card Review change",
    });
    const board = container.querySelector<HTMLElement>(
      ".kanban-board-editor__columns",
    );
    const columns = container.querySelectorAll<HTMLElement>(".kanban-column");
    const cards = container.querySelectorAll<HTMLElement>(".kanban-card");
    mockRect(board!, 0, 0, 800, 600);
    mockRect(columns[0], 20, 20, 280, 520);
    mockRect(columns[1], 320, 20, 280, 520);
    mockRect(cards[0], 40, 100, 240, 100);
    mockRect(cards[1], 40, 220, 240, 100);

    fireEvent.pointerDown(handle, {
      pointerId: 2,
      button: 0,
      clientX: 100,
      clientY: 260,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 2,
      clientX: 100,
      clientY: 80,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 2,
      clientX: 100,
      clientY: 80,
    });

    await act(async () => {});
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          type: "move-card",
          cardId: "card-review",
          targetColumnId: "column-backlog",
          beforeCardId: "card-spec",
        },
      }),
    );
  });

  it("supports pointer column reordering", async () => {
    const moved: PluginKanbanBoardModel = {
      ...model,
      columns: [model.columns[1], model.columns[0]],
    };
    const edit = vi.fn(async () => ({ source: "dragged source", model: moved }));
    renderBoard({ edit });
    await screen.findByRole("heading", { name: "Release board" });
    const handle = screen.getByRole("button", {
      name: "Reorder column Doing",
    });
    const backlog = screen
      .getByRole("button", { name: "Backlog" })
      .closest(".kanban-column") as HTMLElement;
    const board = document.querySelector<HTMLElement>(
      ".kanban-board-editor__columns",
    );
    const doing = screen
      .getByRole("button", { name: "Doing" })
      .closest(".kanban-column") as HTMLElement;
    mockRect(board!, 0, 0, 800, 600);
    mockRect(backlog!, 20, 20, 280, 520);
    mockRect(doing!, 320, 20, 280, 520);

    fireEvent.pointerDown(handle, {
      pointerId: 3,
      button: 0,
      clientX: 450,
      clientY: 80,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 3,
      clientX: 80,
      clientY: 80,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 3,
      clientX: 80,
      clientY: 80,
    });

    await act(async () => {});
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          type: "move-column",
          columnId: "column-doing",
          beforeColumnId: "column-backlog",
        },
      }),
    );
  });

  it("refuses a stale worker edit after the open source changes", async () => {
    let finishEdit:
      | ((value: { source: string; model: PluginKanbanBoardModel }) => void)
      | null = null;
    const edit = vi.fn(
      () =>
        new Promise<{ source: string; model: PluginKanbanBoardModel }>(
          (resolve) => {
            finishEdit = resolve;
          },
        ),
    );
    const onChange = vi.fn();
    const onError = vi.fn();
    const parse = vi.fn(async () => model);
    const rendered = render(
      <KanbanBoardEditor
        title="Kanban boards"
        path="Release.kanban.md"
        source="first source"
        readOnly={false}
        parse={parse}
        edit={edit}
        onChange={onChange}
        onLinkOpen={vi.fn()}
        onError={onError}
      />,
    );
    const handle = await screen.findByRole("button", {
      name: "Reorder card Write specification",
    });
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "ArrowDown" });

    rendered.rerender(
      <KanbanBoardEditor
        title="Kanban boards"
        path="Release.kanban.md"
        source="second source"
        readOnly={false}
        parse={parse}
        edit={edit}
        onChange={onChange}
        onLinkOpen={vi.fn()}
        onError={onError}
      />,
    );
    await act(async () => {
      finishEdit?.({ source: "stale result", model });
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/changed before this edit completed/i),
      }),
    );
  });
});

function mockRect(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  });
}
