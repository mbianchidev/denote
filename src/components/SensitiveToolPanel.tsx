import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export function SensitiveToolPanel({ title, feature, onClose, onEscape, children }: {
  title: string; onClose: () => void; onEscape?: () => void; children: ReactNode;
  feature: "speech" | "credential-store";
}) {
  const root = useRef<HTMLElement>(null);
  const previous = useRef(document.activeElement);
  useEffect(() => {
    const panel = root.current;
    if (!panel?.contains(document.activeElement)) panel?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (panel?.contains(document.activeElement) && previous.current instanceof HTMLElement && previous.current.isConnected) previous.current.focus();
    };
  }, []);
  return <section ref={root} className="sidebar-view sensitive-tool-panel" aria-label={title} data-sensitive-tool={feature}
    onKeyDownCapture={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      (onEscape ?? onClose)();
    }}>
    <header className="sidebar-view__title">
      <h2>{title}</h2>
      <button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>
    <div className="sensitive-tool-panel__body">{children}</div>
  </section>;
}
