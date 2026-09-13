import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginKanbanBoardModel,
  PluginKanbanEditRequest,
} from "@denote/plugin-sdk";
import { KanbanBoardEditor } from "./KanbanBoardEditor";

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

  it("provides keyboard-operable alternatives for every card and column move", async () => {
    renderBoard();
    await screen.findByRole("heading", { name: "Release board" });

    expect(
      screen.getByRole("button", { name: "Move Backlog right" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move Write specification down" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Move Write specification to next column",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Move Write specification to previous column",
      }),
    ).toBeDisabled();
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
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: "Move Write specification to next column",
      }),
    );

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
        screen.getByRole("button", { name: "Edit Write specification" }),
      ).toHaveFocus(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved card Write specification to Doing",
    );
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

  it("supports pointer card dragging while leaving the same move available as buttons", async () => {
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
    const edit = vi.fn(async () => ({ source: "dragged source", model: moved }));
    const { container } = renderBoard({ edit });
    await screen.findByRole("heading", { name: "Release board" });
    const handles = container.querySelectorAll<HTMLElement>(
      ".kanban-card .kanban-drag-handle",
    );
    const cards = container.querySelectorAll<HTMLElement>(".kanban-card");
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "all",
      types: [] as string[],
      setData(type: string, value: string) {
        values.set(type, value);
        if (!this.types.includes(type)) {
          this.types.push(type);
        }
      },
      getData(type: string) {
        return values.get(type) ?? "";
      },
    };

    fireEvent.dragStart(handles[0], { dataTransfer });
    fireEvent.dragOver(cards[1], { dataTransfer });
    fireEvent.drop(cards[1], { dataTransfer });

    await act(async () => {});
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        edit: {
          type: "move-card",
          cardId: "card-spec",
          targetColumnId: "column-backlog",
          beforeCardId: "card-review",
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
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Move Write specification down",
      }),
    );

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
