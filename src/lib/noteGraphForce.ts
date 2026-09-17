import type {
  PluginNoteGraphModel,
  PluginNoteGraphNode,
} from "@denote/plugin-sdk";
import {
  MAX_PLUGIN_NOTE_GRAPH_EDGES,
  MAX_PLUGIN_NOTE_GRAPH_NODES,
} from "@denote/plugin-sdk";

export const NOTE_GRAPH_VIEW_WIDTH = 640;
export const NOTE_GRAPH_VIEW_HEIGHT = 520;

export interface NoteGraphForceSnapshotNode {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface NoteGraphDragTarget {
  id: string;
  x: number;
  y: number;
}

export type NoteGraphForceDragTarget = NoteGraphDragTarget;

export interface NoteGraphClientBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NoteGraphPoint {
  x: number;
  y: number;
}

export interface NoteGraphForceNode extends NoteGraphForceSnapshotNode {
  vx: number;
  vy: number;
  distance: number | null;
  seedX: number;
  seedY: number;
  radialTarget: number;
}

export interface NoteGraphForceSpring {
  source: NoteGraphForceNode;
  target: NoteGraphForceNode;
  restLength: number;
}

export interface NoteGraphForceState {
  nodes: NoteGraphForceNode[];
  nodeById: Map<string, NoteGraphForceNode>;
  springs: NoteGraphForceSpring[];
  alpha: number;
  local: boolean;
}

const CENTER_X = NOTE_GRAPH_VIEW_WIDTH / 2;
const CENTER_Y = NOTE_GRAPH_VIEW_HEIGHT / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FRAME_MS = 1000 / 60;
const MIN_ELAPSED_MS = 0;
const MAX_ELAPSED_MS = 32;
const BOUNDARY_PADDING = 4;
const DRAG_ALPHA = 0.32;
const DEFAULT_REHEAT_ALPHA = 0.72;
const ALPHA_DECAY = 0.96;
const ALPHA_MIN = 0.0025;
const VELOCITY_MIN = 0.015;
const VELOCITY_DAMPING = 0.79;
const SPRING_STRENGTH = 0.013;
const GLOBAL_CENTER_STRENGTH = 0.00055;
const LOCAL_CENTER_STRENGTH = 0.0002;
const LOCAL_RING_STRENGTH = 0.004;
const REPULSION_RANGE = 72;
const REPULSION_STRENGTH = 0.48;
const COLLISION_STRENGTH = 0.15;
const DEFAULT_SETTLE_STEPS = 320;
const MAX_SETTLE_STEPS = 600;

export function createNoteGraphForceState(
  model: PluginNoteGraphModel,
  previous?: NoteGraphForceState | null,
): NoteGraphForceState {
  const modelNodes = model.nodes.slice(0, MAX_PLUGIN_NOTE_GRAPH_NODES);
  const local = modelNodes.some((node) => node.distance !== null);
  const seed = local
    ? localSeedLayout(modelNodes)
    : {
        nodes: modelNodes,
        positions: globalSeedPositions(modelNodes),
      };
  const previousNodes = new Map(
    previous?.nodes.map((node) => [node.id, node]) ?? [],
  );
  const nodes = seed.nodes.map((node) => {
    const prior = previousNodes.get(node.id);
    const position = seed.positions.get(node.id) ?? {
      x: CENTER_X,
      y: CENTER_Y,
    };
    const forceNode: NoteGraphForceNode = {
      id: node.id,
      x: prior && Number.isFinite(prior.x) ? prior.x : position.x,
      y: prior && Number.isFinite(prior.y) ? prior.y : position.y,
      vx: prior && Number.isFinite(prior.vx) ? prior.vx : 0,
      vy: prior && Number.isFinite(prior.vy) ? prior.vy : 0,
      radius: nodeRadius(node),
      distance: node.distance,
      seedX: position.x,
      seedY: position.y,
      radialTarget: Math.hypot(
        position.x - CENTER_X,
        position.y - CENTER_Y,
      ),
    };
    constrainNode(forceNode);
    return forceNode;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const springKeys = new Set<string>();
  const springs: NoteGraphForceSpring[] = [];
  for (const edge of model.edges.slice(0, MAX_PLUGIN_NOTE_GRAPH_EDGES)) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target || source === target) {
      continue;
    }
    const [firstId, secondId] =
      source.id < target.id
        ? [source.id, target.id]
        : [target.id, source.id];
    const key = `${firstId}\u0000${secondId}`;
    if (springKeys.has(key)) {
      continue;
    }
    springKeys.add(key);
    const first = nodeById.get(firstId)!;
    const second = nodeById.get(secondId)!;
    springs.push({
      source: first,
      target: second,
      restLength:
        (local
          ? 60 +
            Math.min(
              24,
              Math.abs((first.distance ?? 3) - (second.distance ?? 3)) * 12,
            )
          : 72) +
        first.radius +
        second.radius,
    });
  }
  springs.sort((left, right) => {
    const sourceOrder = compareIds(left.source.id, right.source.id);
    return sourceOrder || compareIds(left.target.id, right.target.id);
  });
  return {
    nodes,
    nodeById,
    springs,
    alpha:
      nodes.length === 0
        ? 0
        : previous && Number.isFinite(previous.alpha)
          ? clamp(Math.max(previous.alpha, 0.35), 0, 1)
          : previous
            ? 0.35
            : 1,
    local,
  };
}

export function reheatNoteGraphForce(
  state: NoteGraphForceState,
  alpha = DEFAULT_REHEAT_ALPHA,
): void {
  const requestedAlpha = Number.isFinite(alpha)
    ? clamp(alpha, 0, 1)
    : DEFAULT_REHEAT_ALPHA;
  state.alpha = Math.max(state.alpha, requestedAlpha);
}

export function stepNoteGraphForce(
  state: NoteGraphForceState,
  dragTarget?: NoteGraphDragTarget | null,
  elapsedMs = FRAME_MS,
): boolean {
  if (state.nodes.length === 0) {
    state.alpha = 0;
    return false;
  }

  const elapsed = Number.isFinite(elapsedMs)
    ? clamp(elapsedMs, MIN_ELAPSED_MS, MAX_ELAPSED_MS)
    : FRAME_MS;
  const timeScale = elapsed / FRAME_MS;
  const draggedNode = dragTarget
    ? state.nodeById.get(dragTarget.id)
    : undefined;
  if (
    draggedNode &&
    dragTarget &&
    Number.isFinite(dragTarget.x) &&
    Number.isFinite(dragTarget.y)
  ) {
    draggedNode.x = clampNodeX(draggedNode, dragTarget.x);
    draggedNode.y = clampNodeY(draggedNode, dragTarget.y);
    draggedNode.vx = 0;
    draggedNode.vy = 0;
    state.alpha = Math.max(state.alpha, DRAG_ALPHA);
  }
  const activeDraggedNode =
    draggedNode &&
    dragTarget &&
    Number.isFinite(dragTarget.x) &&
    Number.isFinite(dragTarget.y)
      ? draggedNode
      : undefined;
  const forceAlpha = state.alpha;

  applySpringForces(state, forceAlpha, timeScale);
  applyRepulsionForces(state, forceAlpha, timeScale);
  applyPositionForces(state, forceAlpha, timeScale);

  const damping = Math.pow(VELOCITY_DAMPING, timeScale);
  let moving = false;
  for (const node of state.nodes) {
    if (node === activeDraggedNode) {
      node.x = clampNodeX(node, dragTarget!.x);
      node.y = clampNodeY(node, dragTarget!.y);
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= damping;
    node.vy *= damping;
    node.x += node.vx * timeScale;
    node.y += node.vy * timeScale;
    constrainNode(node);
    if (
      Math.abs(node.vx) > VELOCITY_MIN ||
      Math.abs(node.vy) > VELOCITY_MIN
    ) {
      moving = true;
    } else if (state.alpha === 0) {
      node.vx = 0;
      node.vy = 0;
    }
  }

  if (activeDraggedNode) {
    state.alpha = Math.max(
      DRAG_ALPHA,
      state.alpha * Math.pow(ALPHA_DECAY, timeScale),
    );
    return true;
  }
  state.alpha *= Math.pow(ALPHA_DECAY, timeScale);
  if (state.alpha < ALPHA_MIN) {
    state.alpha = 0;
  }
  return state.alpha > 0 || moving;
}

export function settleNoteGraphForce(
  state: NoteGraphForceState,
  dragTarget?: NoteGraphDragTarget | null,
  maxSteps = DEFAULT_SETTLE_STEPS,
): void {
  const steps = Number.isFinite(maxSteps)
    ? Math.floor(clamp(maxSteps, 0, MAX_SETTLE_STEPS))
    : DEFAULT_SETTLE_STEPS;
  for (let index = 0; index < steps; index += 1) {
    if (!stepNoteGraphForce(state, dragTarget, FRAME_MS)) {
      break;
    }
  }
  const draggedNode = dragTarget
    ? state.nodeById.get(dragTarget.id)
    : undefined;
  if (
    draggedNode &&
    dragTarget &&
    Number.isFinite(dragTarget.x) &&
    Number.isFinite(dragTarget.y)
  ) {
    draggedNode.x = clampNodeX(draggedNode, dragTarget.x);
    draggedNode.y = clampNodeY(draggedNode, dragTarget.y);
  }
  for (const node of state.nodes) {
    constrainNode(node);
    node.vx = 0;
    node.vy = 0;
  }
  state.alpha = 0;
}

export function noteGraphPointFromClient(
  clientX: number,
  clientY: number,
  bounds: NoteGraphClientBounds,
  zoom: number,
): NoteGraphPoint {
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY)
  ) {
    return { x: CENTER_X, y: CENTER_Y };
  }
  const meetScale = Math.min(
    bounds.width / NOTE_GRAPH_VIEW_WIDTH,
    bounds.height / NOTE_GRAPH_VIEW_HEIGHT,
  );
  const letterboxX =
    (bounds.width - NOTE_GRAPH_VIEW_WIDTH * meetScale) / 2;
  const letterboxY =
    (bounds.height - NOTE_GRAPH_VIEW_HEIGHT * meetScale) / 2;
  const svgX = (clientX - bounds.left - letterboxX) / meetScale;
  const svgY = (clientY - bounds.top - letterboxY) / meetScale;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: clamp(
      CENTER_X + (svgX - CENTER_X) / safeZoom,
      0,
      NOTE_GRAPH_VIEW_WIDTH,
    ),
    y: clamp(
      CENTER_Y + (svgY - CENTER_Y) / safeZoom,
      0,
      NOTE_GRAPH_VIEW_HEIGHT,
    ),
  };
}

export function snapshotNoteGraphForce(
  state: NoteGraphForceState,
): NoteGraphForceSnapshotNode[] {
  return state.nodes.map(({ id, x, y, radius }) => ({
    id,
    x,
    y,
    radius,
  }));
}

function applySpringForces(
  state: NoteGraphForceState,
  alpha: number,
  timeScale: number,
): void {
  for (const spring of state.springs) {
    let dx = spring.target.x - spring.source.x;
    let dy = spring.target.y - spring.source.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
      const angle = stableAngle(`${spring.source.id}\u0000${spring.target.id}`);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }
    const magnitude =
      (distance - spring.restLength) *
      SPRING_STRENGTH *
      alpha *
      timeScale;
    const forceX = (dx / distance) * magnitude;
    const forceY = (dy / distance) * magnitude;
    spring.source.vx += forceX;
    spring.source.vy += forceY;
    spring.target.vx -= forceX;
    spring.target.vy -= forceY;
  }
}

function applyRepulsionForces(
  state: NoteGraphForceState,
  alpha: number,
  timeScale: number,
): void {
  const grid = new Map<string, number[]>();
  state.nodes.forEach((node, index) => {
    const key = gridKey(node.x, node.y);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      grid.set(key, [index]);
    }
  });

  state.nodes.forEach((node, index) => {
    const cellX = Math.floor(node.x / REPULSION_RANGE);
    const cellY = Math.floor(node.y / REPULSION_RANGE);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const bucket = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
        if (!bucket) {
          continue;
        }
        for (const otherIndex of bucket) {
          if (otherIndex <= index) {
            continue;
          }
          repelPair(
            node,
            state.nodes[otherIndex],
            alpha,
            timeScale,
          );
        }
      }
    }
  });
}

function repelPair(
  first: NoteGraphForceNode,
  second: NoteGraphForceNode,
  alpha: number,
  timeScale: number,
): void {
  let dx = second.x - first.x;
  let dy = second.y - first.y;
  let distance = Math.hypot(dx, dy);
  if (distance >= REPULSION_RANGE) {
    return;
  }
  if (distance < 0.001) {
    const [firstId, secondId] =
      first.id < second.id
        ? [first.id, second.id]
        : [second.id, first.id];
    const angle = stableAngle(`${firstId}\u0000${secondId}`);
    const direction = first.id === firstId ? 1 : -1;
    dx = Math.cos(angle) * direction;
    dy = Math.sin(angle) * direction;
    distance = 1;
  }
  const collisionDistance =
    first.radius + second.radius + BOUNDARY_PADDING * 1.5;
  const proximity = (REPULSION_RANGE - distance) / REPULSION_RANGE;
  const overlap = Math.max(0, collisionDistance - distance);
  const magnitude =
    (proximity * REPULSION_STRENGTH + overlap * COLLISION_STRENGTH) *
    alpha *
    timeScale;
  const forceX = (dx / distance) * magnitude;
  const forceY = (dy / distance) * magnitude;
  first.vx -= forceX;
  first.vy -= forceY;
  second.vx += forceX;
  second.vy += forceY;
}

function applyPositionForces(
  state: NoteGraphForceState,
  alpha: number,
  timeScale: number,
): void {
  for (const node of state.nodes) {
    const centerStrength = state.local
      ? LOCAL_CENTER_STRENGTH
      : GLOBAL_CENTER_STRENGTH;
    node.vx +=
      (CENTER_X - node.x) * centerStrength * alpha * timeScale;
    node.vy +=
      (CENTER_Y - node.y) * centerStrength * alpha * timeScale;
    if (!state.local) {
      continue;
    }

    let dx = node.x - CENTER_X;
    let dy = node.y - CENTER_Y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001 && node.radialTarget > 0) {
      dx = node.seedX - CENTER_X;
      dy = node.seedY - CENTER_Y;
      distance = Math.max(0.001, Math.hypot(dx, dy));
    }
    if (distance >= 0.001) {
      const magnitude =
        (node.radialTarget - distance) *
        LOCAL_RING_STRENGTH *
        alpha *
        timeScale;
      node.vx += (dx / distance) * magnitude;
      node.vy += (dy / distance) * magnitude;
    }
  }
}

function gridKey(x: number, y: number): string {
  return `${Math.floor(x / REPULSION_RANGE)}:${Math.floor(
    y / REPULSION_RANGE,
  )}`;
}

function constrainNode(node: NoteGraphForceNode): void {
  const constrainedX = clampNodeX(node, node.x);
  const constrainedY = clampNodeY(node, node.y);
  if (constrainedX !== node.x && node.vx * (node.x - constrainedX) > 0) {
    node.vx = 0;
  }
  if (constrainedY !== node.y && node.vy * (node.y - constrainedY) > 0) {
    node.vy = 0;
  }
  node.x = constrainedX;
  node.y = constrainedY;
}

function clampNodeX(node: NoteGraphForceNode, x: number): number {
  const padding = node.radius + BOUNDARY_PADDING;
  return clamp(x, padding, NOTE_GRAPH_VIEW_WIDTH - padding);
}

function clampNodeY(node: NoteGraphForceNode, y: number): number {
  const padding = node.radius + BOUNDARY_PADDING;
  return clamp(y, padding, NOTE_GRAPH_VIEW_HEIGHT - padding);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function globalSeedPositions(
  nodes: PluginNoteGraphNode[],
): Map<string, { x: number; y: number }> {
  return new Map(
    nodes.map((node, index) => {
      if (index === 0) {
        return [node.id, { x: CENTER_X, y: CENTER_Y }];
      }
      const progress = Math.sqrt(index / Math.max(1, nodes.length - 1));
      const angle =
        -Math.PI / 2 +
        index * GOLDEN_ANGLE +
        stableAngle(node.path) * 0.035;
      const radius = 34 + progress * 198;
      return [
        node.id,
        {
          x: CENTER_X + Math.cos(angle) * radius,
          y: CENTER_Y + Math.sin(angle) * radius,
        },
      ];
    }),
  );
}

function localSeedLayout(
  nodes: PluginNoteGraphNode[],
): {
  nodes: PluginNoteGraphNode[];
  positions: Map<string, { x: number; y: number }>;
} {
  const byDistance = new Map<number, PluginNoteGraphNode[]>();
  for (const node of nodes) {
    const distance = node.distance ?? 3;
    byDistance.set(distance, [...(byDistance.get(distance) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const orderedNodes: PluginNoteGraphNode[] = [];
  for (const [distance, ringNodes] of [...byDistance.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    ringNodes.forEach((node, index) => {
      orderedNodes.push(node);
      const progress =
        ringNodes.length <= 1
          ? 0
          : index / Math.max(1, ringNodes.length - 1);
      const ringRadius =
        distance === 0
          ? 0
          : Math.min(232, 54 + distance * 54 + progress * 34);
      const angle =
        -Math.PI / 2 +
        index * GOLDEN_ANGLE +
        stableAngle(node.path) * 0.04;
      positions.set(node.id, {
        x: CENTER_X + Math.cos(angle) * ringRadius,
        y: CENTER_Y + Math.sin(angle) * ringRadius,
      });
    });
  }
  return { nodes: orderedNodes, positions };
}

function nodeRadius(node: PluginNoteGraphNode): number {
  return (
    5 + Math.min(5, Math.log2(node.incoming + node.outgoing + 1) * 1.6)
  );
}

function stableAngle(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}
