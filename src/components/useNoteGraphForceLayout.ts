import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PluginNoteGraphModel } from "@denote/plugin-sdk";
import {
  createNoteGraphForceState,
  reheatNoteGraphForce,
  settleNoteGraphForce,
  snapshotNoteGraphForce,
  stepNoteGraphForce,
  type NoteGraphDragTarget,
  type NoteGraphForceSnapshotNode,
  type NoteGraphForceState,
} from "../lib/noteGraphForce";

interface NoteGraphForceLayout {
  nodes: NoteGraphForceSnapshotNode[];
  draggingNodeId: string | null;
  beginDrag: (target: NoteGraphDragTarget) => void;
  moveDrag: (target: NoteGraphDragTarget) => void;
  endDrag: () => void;
  cancelDrag: () => void;
}

const PUBLISH_INTERVAL_MS = 32;

export function useNoteGraphForceLayout(
  model: PluginNoteGraphModel | null,
): NoteGraphForceLayout {
  const reducedMotion = useReducedMotion();
  const state = useRef<NoteGraphForceState | null>(null);
  const dragTarget = useRef<NoteGraphDragTarget | null>(null);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const lastPublish = useRef(0);
  const [nodes, setNodes] = useState<NoteGraphForceSnapshotNode[]>([]);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  const publish = useCallback(() => {
    setNodes(state.current ? snapshotNoteGraphForce(state.current) : []);
  }, []);

  const stopAnimation = useCallback(() => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    lastFrame.current = null;
  }, []);

  const animate = useCallback(
    (timestamp: number) => {
      frame.current = null;
      const current = state.current;
      if (!current || reducedMotion) {
        return;
      }
      if (
        dragTarget.current &&
        !current.nodeById.has(dragTarget.current.id)
      ) {
        dragTarget.current = null;
        setDraggingNodeId(null);
      }
      const elapsed =
        lastFrame.current === null ? 16 : timestamp - lastFrame.current;
      lastFrame.current = timestamp;
      const active = stepNoteGraphForce(
        current,
        dragTarget.current,
        elapsed,
      );
      if (
        timestamp - lastPublish.current >= PUBLISH_INTERVAL_MS ||
        !active
      ) {
        lastPublish.current = timestamp;
        publish();
      }
      if (active || dragTarget.current !== null) {
        frame.current = window.requestAnimationFrame(animate);
      } else {
        lastFrame.current = null;
      }
    },
    [publish, reducedMotion],
  );

  const schedule = useCallback(() => {
    const current = state.current;
    if (!current) {
      return;
    }
    if (reducedMotion || typeof window.requestAnimationFrame !== "function") {
      settleNoteGraphForce(
        current,
        dragTarget.current,
        dragTarget.current ? 2 : 8,
      );
      publish();
      return;
    }
    if (frame.current === null) {
      frame.current = window.requestAnimationFrame(animate);
    }
  }, [animate, publish, reducedMotion]);

  useEffect(() => {
    if (!model || model.nodes.length === 0) {
      state.current = null;
      dragTarget.current = null;
      setDraggingNodeId(null);
      stopAnimation();
      setNodes([]);
      return;
    }
    state.current = createNoteGraphForceState(model, state.current);
    if (
      dragTarget.current &&
      !state.current.nodeById.has(dragTarget.current.id)
    ) {
      dragTarget.current = null;
      setDraggingNodeId(null);
    }
    reheatNoteGraphForce(state.current, 0.85);
    if (reducedMotion) {
      settleNoteGraphForce(state.current, null, 8);
    }
    publish();
    schedule();
  }, [model, publish, reducedMotion, schedule, stopAnimation]);

  useEffect(() => {
    if (!reducedMotion) {
      return;
    }
    stopAnimation();
    const current = state.current;
    if (current) {
      settleNoteGraphForce(current, dragTarget.current, 8);
      publish();
    }
  }, [publish, reducedMotion, stopAnimation]);

  useEffect(() => stopAnimation, [stopAnimation]);

  const beginDrag = useCallback(
    (target: NoteGraphDragTarget) => {
      const current = state.current;
      if (!current) {
        return;
      }
      dragTarget.current = target;
      setDraggingNodeId(target.id);
      reheatNoteGraphForce(current, 0.9);
      stepNoteGraphForce(current, target, 0);
      publish();
      schedule();
    },
    [publish, schedule],
  );

  const moveDrag = useCallback(
    (target: NoteGraphDragTarget) => {
      const current = state.current;
      if (!current || dragTarget.current?.id !== target.id) {
        return;
      }
      dragTarget.current = target;
      reheatNoteGraphForce(current, 0.55);
      stepNoteGraphForce(current, target, 0);
      publish();
      schedule();
    },
    [publish, schedule],
  );

  const finishDrag = useCallback(
    (settle: boolean) => {
      const current = state.current;
      dragTarget.current = null;
      setDraggingNodeId(null);
      if (!current) {
        return;
      }
      if (settle) {
        reheatNoteGraphForce(current, 0.42);
      }
      schedule();
    },
    [schedule],
  );

  return {
    nodes,
    draggingNodeId,
    beginDrag,
    moveDrag,
    endDrag: () => finishDrag(true),
    cancelDrag: () => finishDrag(false),
  };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window.matchMedia !== "function") {
      return true;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reduced;
}
