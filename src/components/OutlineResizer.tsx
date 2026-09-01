import { useRef, type PointerEvent } from "react";
import {
  clampOutlineWidth,
  DEFAULT_OUTLINE_WIDTH,
  MAX_OUTLINE_WIDTH,
  MIN_OUTLINE_WIDTH,
} from "../lib/outlineWidth";

interface OutlineResizerProps {
  width: number;
  disabled?: boolean;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}

export function OutlineResizer({
  width,
  disabled = false,
  onChange,
  onCommit,
}: OutlineResizerProps) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    onCommit(current.currentWidth);
  };

  return (
    <div
      className="outline-resizer"
      role="separator"
      aria-label="Resize document outline"
      aria-orientation="vertical"
      aria-valuemin={MIN_OUTLINE_WIDTH}
      aria-valuemax={MAX_OUTLINE_WIDTH}
      aria-valuenow={width}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title="Drag or use the arrow keys to resize the document outline"
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) {
          return;
        }
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          currentWidth: width,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        const next = clampOutlineWidth(
          current.startWidth - (event.clientX - current.startX),
        );
        current.currentWidth = next;
        onChange(next);
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        const current = drag.current;
        drag.current = null;
        if (current) {
          onChange(current.startWidth);
        }
      }}
      onKeyDown={(event) => {
        if (disabled) {
          return;
        }
        const step = event.shiftKey ? 32 : 12;
        let next: number | null = null;
        if (event.key === "ArrowLeft") {
          next = clampOutlineWidth(width + step);
        } else if (event.key === "ArrowRight") {
          next = clampOutlineWidth(width - step);
        } else if (event.key === "Home") {
          next = DEFAULT_OUTLINE_WIDTH;
        } else if (event.key === "End") {
          next = MAX_OUTLINE_WIDTH;
        }
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          onChange(next);
          onCommit(next);
        }
      }}
    />
  );
}
