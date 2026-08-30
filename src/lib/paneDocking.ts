import type { PaneDockPosition } from "./panes";

export const PANE_DOCK_EDGE_RATIO = 0.24;

export interface PaneDockBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaneDockTarget {
  paneId: string;
  position: PaneDockPosition;
}

export function dockPositionForPoint(
  bounds: PaneDockBounds,
  clientX: number,
  clientY: number,
  edgeRatio = PANE_DOCK_EDGE_RATIO,
): PaneDockPosition {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return "center";
  }
  const x = (clientX - bounds.left) / bounds.width;
  const y = (clientY - bounds.top) / bounds.height;
  const candidates: { position: PaneDockPosition; distance: number }[] = [
    { position: "left", distance: x },
    { position: "right", distance: 1 - x },
    { position: "top", distance: y },
    { position: "bottom", distance: 1 - y },
  ];
  const nearest = candidates.reduce((closest, candidate) =>
    candidate.distance < closest.distance ? candidate : closest,
  );
  return nearest.distance <= edgeRatio ? nearest.position : "center";
}

export function paneDockTargetFromPoint(
  clientX: number,
  clientY: number,
): PaneDockTarget | null {
  const element = document.elementFromPoint?.(clientX, clientY);
  if (!element) {
    return null;
  }
  if (element.closest(".workspace-pane__header") || element.closest(".tab")) {
    return null;
  }
  const editor = element.closest<HTMLElement>(".editor-pane");
  const pane = editor?.closest<HTMLElement>(".workspace-pane");
  const paneId = pane?.dataset.paneId;
  if (!editor || !pane || !paneId) {
    return null;
  }
  const rect = editor.getBoundingClientRect();
  return {
    paneId,
    position: dockPositionForPoint(
      {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      clientX,
      clientY,
    ),
  };
}

export function sameDockTarget(
  a: PaneDockTarget | null,
  b: PaneDockTarget | null,
): boolean {
  if (a === b) {
    return true;
  }
  return (
    a !== null &&
    b !== null &&
    a.paneId === b.paneId &&
    a.position === b.position
  );
}
