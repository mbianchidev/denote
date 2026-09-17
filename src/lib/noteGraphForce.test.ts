// @vitest-environment node

import type {
  PluginNoteGraphModel,
  PluginNoteGraphNode,
} from "@denote/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  NOTE_GRAPH_VIEW_HEIGHT,
  NOTE_GRAPH_VIEW_WIDTH,
  createNoteGraphForceState,
  noteGraphPointFromClient,
  reheatNoteGraphForce,
  settleNoteGraphForce,
  snapshotNoteGraphForce,
  stepNoteGraphForce,
} from "./noteGraphForce";

function graphNode(
  id: string,
  overrides: Partial<PluginNoteGraphNode> = {},
): PluginNoteGraphNode {
  return {
    id,
    path: id,
    title: id,
    tags: [],
    incoming: 0,
    outgoing: 0,
    orphan: true,
    distance: null,
    ...overrides,
  };
}

function graphModel(
  nodes: PluginNoteGraphNode[],
  edges: PluginNoteGraphModel["edges"] = [],
): PluginNoteGraphModel {
  return {
    nodes,
    edges,
    totalNotes: nodes.length,
    matchingNotes: nodes.length,
    totalEdges: edges.length,
    activeNodeId: nodes[0]?.id ?? null,
    truncated: false,
    notices: [],
  };
}

describe("note graph force layout", () => {
  it("seeds the existing global and local constellations deterministically", () => {
    const global = graphModel([
      graphNode("Alpha.md"),
      graphNode("Beta.md"),
      graphNode("Gamma.md"),
    ]);
    const first = snapshotNoteGraphForce(createNoteGraphForceState(global));
    const second = snapshotNoteGraphForce(createNoteGraphForceState(global));

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      id: "Alpha.md",
      x: NOTE_GRAPH_VIEW_WIDTH / 2,
      y: NOTE_GRAPH_VIEW_HEIGHT / 2,
      radius: 5,
    });

    const local = snapshotNoteGraphForce(
      createNoteGraphForceState(
        graphModel([
          graphNode("Far.md", { distance: 2 }),
          graphNode("Root.md", { distance: 0 }),
          graphNode("Near.md", { distance: 1 }),
        ]),
      ),
    );
    expect(local.map(({ id }) => id)).toEqual([
      "Root.md",
      "Near.md",
      "Far.md",
    ]);
    expect(local.find(({ id }) => id === "Root.md")).toMatchObject({
      x: NOTE_GRAPH_VIEW_WIDTH / 2,
      y: NOTE_GRAPH_VIEW_HEIGHT / 2,
    });
    expect(local.find(({ id }) => id === "Near.md")).not.toMatchObject({
      x: NOTE_GRAPH_VIEW_WIDTH / 2,
      y: NOTE_GRAPH_VIEW_HEIGHT / 2,
    });
  });

  it("preserves surviving positions and velocities while reconciling nodes", () => {
    const previous = createNoteGraphForceState(
      graphModel([graphNode("Keep.md"), graphNode("Remove.md")]),
    );
    const kept = previous.nodes.find(({ id }) => id === "Keep.md")!;
    kept.x = 123;
    kept.y = 234;
    kept.vx = 1.25;
    kept.vy = -0.75;

    const next = createNoteGraphForceState(
      graphModel([graphNode("Add.md"), graphNode("Keep.md")]),
      previous,
    );

    expect(next.nodes.find(({ id }) => id === "Keep.md")).toMatchObject({
      x: 123,
      y: 234,
      vx: 1.25,
      vy: -0.75,
    });
    expect(next.nodes.some(({ id }) => id === "Remove.md")).toBe(false);
    expect(next.nodes.find(({ id }) => id === "Add.md")).toMatchObject({
      vx: 0,
      vy: 0,
    });
  });

  it("uses one physical spring for duplicate and opposite directed edges", () => {
    const state = createNoteGraphForceState(
      graphModel(
        [graphNode("Alpha.md"), graphNode("Beta.md")],
        [
          { sourceId: "Alpha.md", targetId: "Beta.md" },
          { sourceId: "Beta.md", targetId: "Alpha.md" },
          { sourceId: "Alpha.md", targetId: "Beta.md" },
        ],
      ),
    );

    expect(state.springs).toHaveLength(1);
    expect(
      [state.springs[0].source.id, state.springs[0].target.id].sort(),
    ).toEqual(["Alpha.md", "Beta.md"]);
  });

  it("pins a dragged node while springs and local repulsion move neighbors", () => {
    const state = createNoteGraphForceState(
      graphModel(
        [
          graphNode("Dragged.md"),
          graphNode("Neighbor.md"),
          graphNode("Nearby.md"),
        ],
        [{ sourceId: "Dragged.md", targetId: "Neighbor.md" }],
      ),
    );
    const dragged = state.nodeById.get("Dragged.md")!;
    const neighbor = state.nodeById.get("Neighbor.md")!;
    const nearby = state.nodeById.get("Nearby.md")!;
    Object.assign(dragged, { x: 320, y: 260, vx: 0, vy: 0 });
    Object.assign(neighbor, { x: 250, y: 260, vx: 0, vy: 0 });
    Object.assign(nearby, { x: 250, y: 264, vx: 0, vy: 0 });
    const initialNeighborX = neighbor.x;
    const initialSeparation = Math.hypot(
      neighbor.x - nearby.x,
      neighbor.y - nearby.y,
    );

    reheatNoteGraphForce(state, 1);
    for (let index = 0; index < 12; index += 1) {
      expect(
        stepNoteGraphForce(
          state,
          { id: dragged.id, x: 420, y: 260 },
          16,
        ),
      ).toBe(true);
    }

    expect(dragged).toMatchObject({ x: 420, y: 260 });
    expect(neighbor.x).toBeGreaterThan(initialNeighborX);
    expect(
      Math.hypot(neighbor.x - nearby.x, neighbor.y - nearby.y),
    ).toBeGreaterThan(initialSeparation);
  });

  it("settles in bounded steps and leaves every node inside the view", () => {
    const state = createNoteGraphForceState(
      graphModel(
        [
          graphNode("Alpha.md"),
          graphNode("Beta.md"),
          graphNode("Gamma.md"),
        ],
        [
          { sourceId: "Alpha.md", targetId: "Beta.md" },
          { sourceId: "Beta.md", targetId: "Gamma.md" },
        ],
      ),
    );
    Object.assign(state.nodes[0], {
      x: -100,
      y: NOTE_GRAPH_VIEW_HEIGHT + 100,
      vx: -200,
      vy: 200,
    });
    reheatNoteGraphForce(state, 1);

    settleNoteGraphForce(state, undefined, 400);

    expect(state.alpha).toBe(0);
    expect(stepNoteGraphForce(state)).toBe(false);
    for (const node of snapshotNoteGraphForce(state)) {
      expect(node.x).toBeGreaterThanOrEqual(node.radius);
      expect(node.x).toBeLessThanOrEqual(NOTE_GRAPH_VIEW_WIDTH - node.radius);
      expect(node.y).toBeGreaterThanOrEqual(node.radius);
      expect(node.y).toBeLessThanOrEqual(
        NOTE_GRAPH_VIEW_HEIGHT - node.radius,
      );
    }
  });

  it("cools naturally after a drag is released", () => {
    const state = createNoteGraphForceState(
      graphModel(
        [graphNode("Alpha.md"), graphNode("Beta.md")],
        [{ sourceId: "Alpha.md", targetId: "Beta.md" }],
      ),
    );
    stepNoteGraphForce(
      state,
      { id: "Alpha.md", x: 500, y: 400 },
      16,
    );

    let animating = true;
    for (let index = 0; index < 300 && animating; index += 1) {
      animating = stepNoteGraphForce(state, undefined, 16);
    }

    expect(animating).toBe(false);
    expect(state.alpha).toBe(0);
  });

  it("clamps long frame gaps and positions without bouncing past bounds", () => {
    const model = graphModel([graphNode("Alpha.md")]);
    const regularFrame = createNoteGraphForceState(model);
    const longFrame = createNoteGraphForceState(model);
    for (const state of [regularFrame, longFrame]) {
      Object.assign(state.nodes[0], {
        x: NOTE_GRAPH_VIEW_WIDTH - 2,
        y: 2,
        vx: 500,
        vy: -500,
      });
      reheatNoteGraphForce(state, 1);
    }

    stepNoteGraphForce(regularFrame, undefined, 32);
    stepNoteGraphForce(longFrame, undefined, 10_000);

    expect(snapshotNoteGraphForce(longFrame)).toEqual(
      snapshotNoteGraphForce(regularFrame),
    );
    const [node] = snapshotNoteGraphForce(longFrame);
    expect(node.x).toBeLessThanOrEqual(NOTE_GRAPH_VIEW_WIDTH - node.radius);
    expect(node.y).toBeGreaterThanOrEqual(node.radius);
  });

  it("inverts SVG letterboxing and center zoom for pointer coordinates", () => {
    const squareBounds = {
      left: 100,
      top: 50,
      width: 800,
      height: 800,
    };

    expect(noteGraphPointFromClient(500, 450, squareBounds, 1)).toEqual({
      x: 320,
      y: 260,
    });
    expect(noteGraphPointFromClient(700, 300, squareBounds, 2)).toEqual({
      x: 400,
      y: 200,
    });
    expect(noteGraphPointFromClient(0, 0, squareBounds, 1)).toEqual({
      x: 0,
      y: 0,
    });

    expect(
      noteGraphPointFromClient(
        230,
        20,
        { left: 50, top: 20, width: 1_000, height: 520 },
        1,
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});
