import { Bug, Info, RefreshCw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { shortCommitHash, type BuildInfo } from "../lib/buildInfo";
import type { AvailableUpdate, RuntimeInfo } from "../types";

export type UpdateUiState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "downloading"; update: AvailableUpdate; downloaded: number; total: number | null }
  | { status: "ready"; update: AvailableUpdate }
  | { status: "installing"; update: AvailableUpdate }
  | { status: "error"; message: string };

interface AboutDialogProps {
  open: boolean;
  buildInfo: BuildInfo;
  runtimeInfo: RuntimeInfo | null;
  updateState: UpdateUiState;
  onCheckForUpdates: () => void;
  onRestartUpdate: (update: AvailableUpdate) => void;
  onReportBug: () => void;
  onClose: () => void;
}

export function AboutDialog({
  open,
  buildInfo,
  runtimeInfo,
  updateState,
  onCheckForUpdates,
  onRestartUpdate,
  onReportBug,
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
          <div>
            <dt>Platform</dt>
            <dd>
              {runtimeInfo
                ? `${runtimeInfo.operatingSystem} · ${runtimeInfo.architecture}`
                : "Loading…"}
            </dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{runtimeInfo?.bundleType ?? "Loading…"}</dd>
          </div>
          <div>
            <dt>Update channel</dt>
            <dd>{runtimeInfo?.updateChannel ?? "Loading…"}</dd>
          </div>
        </dl>
        <p className="about-dialog__commit">
          Full commit: <code>{buildInfo.commitHash}</code>
          {buildInfo.dirty ? " (dirty build)" : ""}
        </p>
        <div className="about-dialog__update" aria-live="polite">
          <p>{updateStatusText(runtimeInfo, updateState)}</p>
          {updateState.status === "downloading" ? (
            <progress
              aria-label="Update download progress"
              value={updateState.downloaded}
              max={updateState.total ?? undefined}
            />
          ) : null}
        </div>
      </div>
      <footer className="about-dialog__actions">
        <button type="button" className="secondary-button" onClick={onReportBug}>
          <Bug aria-hidden="true" size={16} />
          Report a bug
        </button>
        {updateState.status === "ready" ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => onRestartUpdate(updateState.update)}
          >
            <RefreshCw aria-hidden="true" size={16} />
            Restart to update
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={
              !runtimeInfo?.updaterConfigured ||
              updateState.status === "checking" ||
              updateState.status === "downloading" ||
              updateState.status === "installing"
            }
            onClick={onCheckForUpdates}
          >
            <RefreshCw aria-hidden="true" size={16} />
            Check for updates
          </button>
        )}
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  );
}

function updateStatusText(
  runtimeInfo: RuntimeInfo | null,
  state: UpdateUiState,
): string {
  if (!runtimeInfo) {
    return "Loading update channel information.";
  }
  if (!runtimeInfo.updaterConfigured) {
    return runtimeInfo.updateChannel === "development"
      ? "Updates are unavailable in Denote Development."
      : "The stable update channel is not configured with a trusted public key.";
  }
  switch (state.status) {
    case "idle":
      return "Denote checks for and downloads signed stable updates automatically after startup.";
    case "checking":
      return "Checking the signed stable release metadata…";
    case "current":
      return "This is the latest stable Denote release.";
    case "downloading":
      return `Downloading and verifying Denote ${state.update.version}…`;
    case "ready":
      return `Denote ${state.update.version} is ready. Restart when you choose to install it.`;
    case "installing":
      return `Installing Denote ${state.update.version}…`;
    case "error":
      return state.message;
  }
}
