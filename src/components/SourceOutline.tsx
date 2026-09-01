import { Braces, MoveVertical } from "lucide-react";
import type {
  SourceMinimapLine,
  SourceSymbol,
  SourceViewport,
} from "../lib/sourceOutline";

interface SourceOutlineProps {
  symbols: SourceSymbol[];
  minimap: SourceMinimapLine[];
  viewport: SourceViewport | null;
  loading?: boolean;
  onNavigateLine: (line: number) => void;
  onNavigateProgress: (progress: number) => void;
}

export function SourceOutline({
  symbols,
  minimap,
  viewport,
  loading = false,
  onNavigateLine,
  onNavigateProgress,
}: SourceOutlineProps) {
  const totalLines = Math.max(1, viewport?.totalLines ?? 1);
  const firstLine = Math.max(1, viewport?.firstLine ?? 1);
  const lastLine = Math.max(firstLine, viewport?.lastLine ?? firstLine);
  const visibleFraction = Math.min(
    1,
    Math.max(0.08, (lastLine - firstLine + 1) / totalLines),
  );
  const progress = Math.min(1, Math.max(0, viewport?.progress ?? 0));
  const thumbTop = progress * (1 - visibleFraction);

  const navigateFromPointer = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.height <= 0) {
      return;
    }
    onNavigateProgress(
      Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    );
  };

  return (
    <aside className="toc-panel source-outline" aria-label="Source outline">
      <div className="toc-panel__title">
        <Braces aria-hidden="true" size={15} />
        Outline
      </div>
      <div className="source-outline__body">
        <section className="source-outline__symbol-section">
          <h3>Functions and symbols</h3>
          <div className="source-outline__symbols">
            {symbols.length > 0 ? (
              symbols.map((symbol, index) => (
                <button
                  type="button"
                  key={`${symbol.line}-${symbol.name}-${index}`}
                  style={
                    { "--symbol-depth": symbol.depth } as React.CSSProperties
                  }
                  data-visible={
                    symbol.line >= firstLine && symbol.line <= lastLine
                      ? "true"
                      : undefined
                  }
                  onClick={() => onNavigateLine(symbol.line)}
                >
                  <span>{symbol.name}</span>
                  <small>
                    {symbol.kind} · {symbol.line}
                  </small>
                </button>
              ))
            ) : loading ? (
              <p className="toc-empty" role="status">
                Building outline…
              </p>
            ) : (
              <p className="toc-empty">No functions or symbols found.</p>
            )}
          </div>
        </section>
        <section className="source-outline__minimap-section">
          <h3>
            <MoveVertical aria-hidden="true" size={13} />
            Code map
          </h3>
          <div
            className="source-outline__minimap"
            role="slider"
            tabIndex={0}
            aria-label="Document position"
            aria-orientation="vertical"
            aria-valuemin={1}
            aria-valuemax={totalLines}
            aria-valuenow={firstLine}
            aria-valuetext={`Lines ${firstLine} to ${lastLine} of ${totalLines}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              navigateFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                navigateFromPointer(event);
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onKeyDown={(event) => {
              const visibleLines = Math.max(1, lastLine - firstLine + 1);
              const lineStep = Math.max(1, Math.floor(visibleLines / 4));
              let targetLine: number | null = null;
              if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                targetLine = firstLine - lineStep;
              } else if (
                event.key === "ArrowDown" ||
                event.key === "ArrowRight"
              ) {
                targetLine = firstLine + lineStep;
              } else if (event.key === "PageUp") {
                targetLine = firstLine - visibleLines;
              } else if (event.key === "PageDown") {
                targetLine = firstLine + visibleLines;
              } else if (event.key === "Home") {
                targetLine = 1;
              } else if (event.key === "End") {
                targetLine = totalLines;
              }
              if (targetLine !== null) {
                event.preventDefault();
                onNavigateProgress(
                  totalLines <= 1
                    ? 0
                    : Math.min(
                        1,
                        Math.max(0, (targetLine - 1) / (totalLines - 1)),
                      ),
                );
              }
            }}
          >
            <span className="source-outline__minimap-lines" aria-hidden="true">
              {minimap.map((line) => (
                <span
                  key={`${line.line}-${line.left}-${line.width}`}
                  data-kind={line.kind}
                  style={{
                    top: `${line.top * 100}%`,
                    left: `${line.left * 100}%`,
                    width: `${line.width * 100}%`,
                  }}
                />
              ))}
            </span>
            <span
              className="source-outline__viewport-window"
              style={{
                height: `${visibleFraction * 100}%`,
                top: `${thumbTop * 100}%`,
              }}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
