import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  paneDockTargetFromPoint,
  type PaneDockTarget,
} from "../lib/paneDocking";
import { dockTab, type PaneWorkspaceState } from "../lib/panes";
import type { EditorTab } from "../types";
import { PaneDockOverlay } from "./PaneDockOverlay";
import { Tabs } from "./Tabs";

describe("PaneDockOverlay", () => {
  it("marks only the hovered zone as active", () => {
    const { container, rerender } = render(<PaneDockOverlay position="left" />);
    const zones = [...container.querySelectorAll(".pane-dock__zone")];

    expect(zones.map((zone) => zone.getAttribute("data-position"))).toEqual([
      "left",
      "right",
      "top",
      "bottom",
      "center",
    ]);
    expect(
      zones
        .filter((zone) => zone.getAttribute("data-active") === "true")
        .map((zone) => zone.getAttribute("data-position")),
    ).toEqual(["left"]);

    rerender(<PaneDockOverlay position="center" />);
    expect(
      [...container.querySelectorAll('.pane-dock__zone[data-active="true"]')].map(
        (zone) => zone.getAttribute("data-position"),
      ),
    ).toEqual(["center"]);

    rerender(<PaneDockOverlay position="tab-strip" />);
    expect(
      [...container.querySelectorAll('.pane-dock__zone[data-active="true"]')].map(
        (zone) => zone.getAttribute("data-position"),
      ),
    ).toEqual(["center"]);
  });

  it("stays out of the way of the pointer and assistive technology", () => {
    const { container } = render(<PaneDockOverlay position="top" />);
    const overlay = container.querySelector(".pane-dock");

    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveAttribute("role", "presentation");
    expect(overlay?.textContent).toBe("");
  });
});

function tab(path: string): EditorTab {
  return {
    path,
    title: path,
    kind: "markdown",
    content: "",
    savedContent: "",
    encoding: "utf8",
    lineEnding: "lf",
    placeholder: false,
    groupId: null,
    rawEditing: false,
    editorRevision: 0,
    editRecorded: false,
    saveState: "saved",
  };
}

function Harness({
  initialState = {
    panes: [
      {
        id: "pane-1",
        tabs: [tab("one.md"), tab("two.md")],
        groups: [],
        activePath: "one.md",
      },
    ],
    layout: { kind: "single", sizes: [] },
    focusedPaneId: "pane-1",
  },
}: {
  initialState?: PaneWorkspaceState;
}) {
  const [state, setState] = useState<PaneWorkspaceState>(initialState);
  const [dockTarget, setDockTarget] = useState<PaneDockTarget | null>(null);
  return (
    <div className="pane-grid" data-layout={state.layout.kind}>
      {state.panes.map((pane) => (
        <section className="workspace-pane" data-pane-id={pane.id} key={pane.id}>
          <div className="workspace-pane__header">
            <Tabs
              tabs={pane.tabs}
              groups={[]}
              activePath={pane.activePath}
              disabled={false}
              label={`Open files in ${pane.id}`}
              onActivate={vi.fn()}
              onClose={vi.fn()}
              onCloseMany={vi.fn()}
              onReorder={vi.fn()}
              onNewTab={vi.fn()}
              onToggleGroup={vi.fn()}
              onCreateGroup={vi.fn()}
              onRenameGroup={vi.fn()}
              onMoveToGroup={vi.fn()}
              onDragMove={(_path, x, y) =>
                setDockTarget(paneDockTargetFromPoint(x, y))
              }
              onDragEnd={(path, x, y) => {
                const target = paneDockTargetFromPoint(x, y);
                setDockTarget(null);
                if (!target) {
                  return false;
                }
                setState((current) =>
                  dockTab(current, path, target.paneId, target.position),
                );
                return true;
              }}
              onDragCancel={() => setDockTarget(null)}
            />
          </div>
          <div className="editor-pane">
            <p data-body={pane.id}>body</p>
            {dockTarget?.paneId === pane.id ? (
              <PaneDockOverlay position={dockTarget.position} />
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

describe("pane docking drag", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("docks a dragged tab into a new pane on the right", () => {
    render(<Harness />);
    const editor = document.querySelector<HTMLElement>(".editor-pane")!;
    editor.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.querySelector("[data-body]")),
    });

    const first = screen.getByRole("tab", { name: /one\.md/i });
    fireEvent.pointerDown(first, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(first, { clientX: 390, clientY: 100, pointerId: 1 });

    expect(
      document.querySelector('.pane-dock__zone[data-active="true"]'),
    ).toHaveAttribute("data-position", "right");

    fireEvent.pointerUp(first, { clientX: 390, clientY: 100, pointerId: 1 });

    const panes = [...document.querySelectorAll(".workspace-pane")];
    expect(panes).toHaveLength(2);
    expect(panes[1].getAttribute("data-pane-id")).toBe("pane-2");
    expect(document.querySelector(".pane-grid")).toHaveAttribute(
      "data-layout",
      "horizontal",
    );
    expect(
      panes[1].querySelectorAll('[data-tab-path="one.md"]'),
    ).toHaveLength(1);
    expect(document.querySelector(".pane-dock")).toBeNull();
  });

  it("adds a dragged tab to another pane from empty tab strip space", () => {
    render(
      <Harness
        initialState={{
          panes: [
            {
              id: "pane-1",
              tabs: [tab("one.md")],
              groups: [],
              activePath: "one.md",
            },
            {
              id: "pane-2",
              tabs: [tab("two.md")],
              groups: [],
              activePath: "two.md",
            },
          ],
          layout: { kind: "horizontal", sizes: [0.5, 0.5] },
          focusedPaneId: "pane-1",
        }}
      />,
    );
    const targetTabStrip = document
      .querySelector<HTMLElement>('[data-pane-id="pane-2"]')
      ?.querySelector<HTMLElement>(".tabs");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => targetTabStrip),
    });

    const first = screen.getByRole("tab", { name: /one\.md/i });
    fireEvent.pointerDown(first, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(first, { clientX: 500, clientY: 10, pointerId: 1 });

    expect(
      document
        .querySelector('[data-pane-id="pane-2"]')
        ?.querySelector('.pane-dock__zone[data-active="true"]'),
    ).toHaveAttribute("data-position", "center");

    fireEvent.pointerUp(first, { clientX: 500, clientY: 10, pointerId: 1 });

    const targetPane = document.querySelector('[data-pane-id="pane-2"]');
    expect(targetPane?.querySelectorAll('[data-tab-path="two.md"]')).toHaveLength(
      1,
    );
    expect(targetPane?.querySelectorAll('[data-tab-path="one.md"]')).toHaveLength(
      1,
    );
    expect(
      targetPane?.querySelector('[data-tab-path="one.md"]'),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("moves a tab to the end of its pane from empty tab strip space", () => {
    render(<Harness />);
    const tabStrip = document.querySelector<HTMLElement>(".tabs");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => tabStrip),
    });

    const first = screen.getByRole("tab", { name: /one\.md/i });
    fireEvent.pointerDown(first, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(first, { clientX: 500, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(first, { clientX: 500, clientY: 10, pointerId: 1 });

    expect(
      screen.getAllByRole("tab").map((tabElement) => tabElement.textContent),
    ).toEqual(["two.md", "one.md"]);
  });
});
