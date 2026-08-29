import { Info, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { shortCommitHash, type BuildInfo } from "../lib/buildInfo";

interface AboutDialogProps {
  open: boolean;
  buildInfo: BuildInfo;
  onClose: () => void;
}

export function AboutDialog({
  open,
  buildInfo,
  onClose,
}: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog about-dialog"
      aria-labelledby="about-title"
      aria-describedby="about-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
    >
      <header className="dialog-header">
        <div>
          <span className="dialog-kicker">
            <Info aria-hidden="true" size={15} />
            Denote
          </span>
          <h2 id="about-title">About Denote</h2>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button"
          aria-label="Close About Denote"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div className="about-dialog__body">
        <p id="about-description">
          A local-first Markdown vault for macOS, Windows, and Linux.
        </p>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{buildInfo.version}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>
              <code title={buildInfo.commitHash}>
                {shortCommitHash(buildInfo.commitHash)}
              </code>
            </dd>
          </div>
          <div>
            <dt>Build state</dt>
            <dd>{buildInfo.dirty ? "Uncommitted changes" : "Clean commit"}</dd>
          </div>
        </dl>
        <p className="about-dialog__commit">
          Full commit: <code>{buildInfo.commitHash}</code>
          {buildInfo.dirty ? " (dirty build)" : ""}
        </p>
      </div>
      <footer className="about-dialog__actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  );
}
