import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function AuthoringDialog({ title, onClose, onEscape, children }: {
  title: string; onClose: () => void; onEscape?: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="app-dialog authoring-dialog" aria-labelledby={id}
    onKeyDownCapture={(event) => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex='0']",
      )].filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-disabled") !== "true" && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); if (onEscape) onEscape(); else close.current(); }}>
    <header className="dialog-header">
      <h2 id={id}>{title}</h2>
      <button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
    </header>
    <div className="authoring-dialog__body">{children}</div>
  </dialog>;
}
