import { useRef, type PointerEvent } from "react";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../lib/sidebarWidth";

interface SidebarResizerProps {
  width: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}

export function SidebarResizer({
  width,
  onChange,
  onCommit,
}: SidebarResizerProps) {
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
      className="sidebar-resizer"
      role="separator"
      aria-label="Resize vault sidebar"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize the vault sidebar"
      onPointerDown={(event) => {
        if (event.button !== 0) {
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
        const next = clampSidebarWidth(
          current.startWidth + event.clientX - current.startX,
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
        let next: number | null = null;
        const step = event.shiftKey ? 32 : 12;
        if (event.key === "ArrowLeft") {
          next = clampSidebarWidth(width - step);
        } else if (event.key === "ArrowRight") {
          next = clampSidebarWidth(width + step);
        } else if (event.key === "Home") {
          next = DEFAULT_SIDEBAR_WIDTH;
        } else if (event.key === "End") {
          next = MAX_SIDEBAR_WIDTH;
        }
        if (next !== null) {
          event.preventDefault();
          onChange(next);
          onCommit(next);
        }
      }}
    />
  );
}
