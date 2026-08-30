import type { PaneDockPosition } from "../lib/panes";

const DOCK_ZONES: Exclude<PaneDockPosition, "tab-strip">[] = [
  "left",
  "right",
  "top",
  "bottom",
  "center",
];

interface PaneDockOverlayProps {
  position: PaneDockPosition;
}

export function PaneDockOverlay({ position }: PaneDockOverlayProps) {
  const activePosition = position === "tab-strip" ? "center" : position;
  return (
    <div className="pane-dock" role="presentation" aria-hidden="true">
      {DOCK_ZONES.map((zone) => (
        <span
          key={zone}
          className="pane-dock__zone"
          data-position={zone}
          data-active={zone === activePosition}
        />
      ))}
    </div>
  );
}
