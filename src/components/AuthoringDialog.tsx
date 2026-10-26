import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function AuthoringDialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
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
    onCancel={(event) => { event.preventDefault(); close.current(); }}>
    <header className="dialog-header">
      <h2 id={id}>{title}</h2>
      <button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
    </header>
    <div className="authoring-dialog__body">{children}</div>
  </dialog>;
}
