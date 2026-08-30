import { useRef, type PointerEvent } from "react";

interface PaneResizerProps {
  label: string;
  orientation: "vertical" | "horizontal";
  value: number;
  style?: React.CSSProperties;
  disabled?: boolean;
  onResize: (delta: number) => void;
  onResizeEnd: () => void;
}

const KEYBOARD_STEP = 0.02;
const KEYBOARD_LARGE_STEP = 0.08;

export function PaneResizer({
  label,
  orientation,
  value,
  style,
  disabled = false,
  onResize,
  onResizeEnd,
}: PaneResizerProps) {
  const drag = useRef<{ pointerId: number; start: number; size: number } | null>(
    null,
  );

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    onResizeEnd();
  };

  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      data-orientation={orientation}
      title="Drag or use the arrow keys to resize this pane"
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) {
          return;
        }
        const bounds =
          event.currentTarget.parentElement?.getBoundingClientRect() ?? null;
        const size =
          orientation === "vertical"
            ? (bounds?.width ?? 0)
            : (bounds?.height ?? 0);
        if (size <= 0) {
          return;
        }
        drag.current = {
          pointerId: event.pointerId,
          start: orientation === "vertical" ? event.clientX : event.clientY,
          size,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        const position =
          orientation === "vertical" ? event.clientX : event.clientY;
        onResize((position - current.start) / current.size);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        if (disabled) {
          return;
        }
        const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
        const decrease = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const increase = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        let delta: number | null = null;
        if (event.key === decrease) {
          delta = -step;
        } else if (event.key === increase) {
          delta = step;
        } else if (event.key === "Home") {
          delta = 0.5 - value;
        }
        if (delta === null) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onResize(delta);
        onResizeEnd();
      }}
    />
  );
}
