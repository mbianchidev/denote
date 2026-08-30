import { Columns2, SplitSquareHorizontal } from "lucide-react";
import {
  layoutsForPaneCount,
  MAX_PANES,
  PANE_LAYOUT_LABELS,
} from "../lib/panes";
import type { PaneLayoutKind } from "../types";

interface PaneControlsProps {
  layout: PaneLayoutKind;
  paneCount: number;
  disabled: boolean;
  splitShortcut: string;
  onLayoutChange: (kind: PaneLayoutKind) => void;
  onAddPane: () => void;
}

export function PaneControls({
  layout,
  paneCount,
  disabled,
  splitShortcut,
  onLayoutChange,
  onAddPane,
}: PaneControlsProps) {
  const options = layoutsForPaneCount(paneCount);
  return (
    <div className="pane-controls" aria-label="Pane layout">
      <button
        type="button"
        className="icon-button"
        aria-label="Split editor into a new pane"
        title={`Split editor into a new pane (${splitShortcut})`}
        disabled={disabled || paneCount >= MAX_PANES}
        onClick={onAddPane}
      >
        <SplitSquareHorizontal aria-hidden="true" size={16} />
      </button>
      <label className="pane-controls__layout">
        <Columns2 aria-hidden="true" size={16} />
        <span className="sr-only">Pane layout</span>
        <select
          value={layout}
          disabled={disabled || options.length < 2}
          onChange={(event) =>
            onLayoutChange(event.target.value as PaneLayoutKind)
          }
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {PANE_LAYOUT_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
