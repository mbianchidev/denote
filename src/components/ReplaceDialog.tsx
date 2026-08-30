import { Replace, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import type {
  ReplaceApplySummary,
  ReplacePreview,
  ReplaceRequest,
  ReplaceScope,
} from "../lib/replace";

interface ReplaceDialogProps {
  open: boolean;
  currentPath: string | null;
  onClose: () => void;
  onPreview: (request: ReplaceRequest) => Promise<ReplacePreview[]>;
  onApply: (
    request: ReplaceRequest,
    previews: ReplacePreview[],
  ) => Promise<ReplaceApplySummary>;
}

export function ReplaceDialog({
  open,
  currentPath,
  onClose,
  onPreview,
  onApply,
}: ReplaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const previewVersion = useRef(0);
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [scope, setScope] = useState<ReplaceScope>(
    currentPath ? "current" : "vault",
  );
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [previews, setPreviews] = useState<ReplacePreview[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const request = useMemo<ReplaceRequest>(
    () => ({ find, replacement, matchCase, wholeWord, scope }),
    [find, matchCase, replacement, scope, wholeWord],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      previewVersion.current += 1;
      setScope(currentPath ? "current" : "vault");
      setPreviews([]);
      setSelectedPaths(new Set());
      setMessage("");
      setBusy(false);
      dialog.showModal();
      window.setTimeout(() => findRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      previewVersion.current += 1;
      dialog.close();
    }
  }, [currentPath, open]);

  const clearPreview = () => {
    previewVersion.current += 1;
    setPreviews([]);
    setSelectedPaths(new Set());
    setMessage("");
  };

  const preview = async () => {
    if (!find) {
      findRef.current?.focus();
      return;
    }
    const version = ++previewVersion.current;
    setBusy(true);
    setMessage("");
    try {
      const nextPreviews = await onPreview(request);
      if (version !== previewVersion.current) {
        return;
      }
      const totalOccurrences = nextPreviews.reduce(
        (total, item) => total + item.occurrences,
        0,
      );
      setPreviews(nextPreviews);
      setSelectedPaths(new Set(nextPreviews.map((item) => item.path)));
      setMessage(
        nextPreviews.length === 0
          ? "No matches found."
          : `${totalOccurrences} replacement${
              totalOccurrences === 1 ? "" : "s"
            } across ${
              nextPreviews.length
            } file${nextPreviews.length === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      if (version === previewVersion.current) {
        setMessage(errorMessage(caught));
      }
    } finally {
      if (version === previewVersion.current) {
        setBusy(false);
      }
    }
  };

  const apply = async () => {
    const selected = previews.filter((item) => selectedPaths.has(item.path));
    if (selected.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const summary = await onApply(request, selected);
      if (summary.failedFiles === 0) {
        setPreviews([]);
        setSelectedPaths(new Set());
        setMessage(
          `${summary.replacedOccurrences} instance${
            summary.replacedOccurrences === 1 ? "" : "s"
          } ${summary.replacedOccurrences === 1 ? "has" : "have"} been replaced.`,
        );
        window.setTimeout(() => findRef.current?.focus(), 0);
      } else {
        setMessage(
          `Replaced ${summary.replacedOccurrences} instance${
            summary.replacedOccurrences === 1 ? "" : "s"
          } in ${summary.appliedFiles} file${
            summary.appliedFiles === 1 ? "" : "s"
          }; ${summary.failedFiles} file${
            summary.failedFiles === 1 ? "" : "s"
          } could not be changed.`,
        );
      }
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog replace-dialog"
      aria-labelledby="replace-dialog-title"
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
            <Replace aria-hidden="true" size={15} />
            Replace
          </span>
          <h2 id="replace-dialog-title">Find and replace</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close replace"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="replace-dialog__form">
        <label>
          <span>Find</span>
          <input
            ref={findRef}
            value={find}
            disabled={busy}
            onChange={(event) => {
              setFind(event.currentTarget.value);
              clearPreview();
            }}
          />
        </label>
        <label>
          <span>Replace with</span>
          <input
            value={replacement}
            disabled={busy}
            onChange={(event) => {
              setReplacement(event.currentTarget.value);
              clearPreview();
            }}
          />
        </label>
        <fieldset className="replace-dialog__scope">
          <legend>Scope</legend>
          <label>
            <input
              type="radio"
              name="replace-scope"
              value="current"
              checked={scope === "current"}
              disabled={!currentPath || busy}
              onChange={() => {
                setScope("current");
                clearPreview();
              }}
            />
            Current note
          </label>
          <label>
            <input
              type="radio"
              name="replace-scope"
              value="vault"
              checked={scope === "vault"}
              disabled={busy}
              onChange={() => {
                setScope("vault");
                clearPreview();
              }}
            />
            Entire vault
          </label>
        </fieldset>
        <div className="replace-dialog__options">
          <label>
            <input
              type="checkbox"
              checked={matchCase}
              disabled={busy}
              onChange={(event) => {
                setMatchCase(event.currentTarget.checked);
                clearPreview();
              }}
            />
            Match case
          </label>
          <label>
            <input
              type="checkbox"
              checked={wholeWord}
              disabled={busy}
              onChange={(event) => {
                setWholeWord(event.currentTarget.checked);
                clearPreview();
              }}
            />
            Whole words
          </label>
        </div>
      </div>

      <div className="replace-dialog__summary">
        <span role="status">{busy ? "Working…" : message}</span>
        {previews.length > 0 ? (
          <span className="replace-dialog__selection-actions">
            <button
              type="button"
              onClick={() =>
                setSelectedPaths(new Set(previews.map((item) => item.path)))
              }
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedPaths(new Set())}
            >
              Select none
            </button>
          </span>
        ) : null}
      </div>

      <div className="replace-preview-list">
        {previews.map((item) => (
          <label className="replace-preview" key={item.path}>
            <input
              type="checkbox"
              checked={selectedPaths.has(item.path)}
              onChange={(event) =>
                setSelectedPaths((current) => {
                  const next = new Set(current);
                  if (event.currentTarget.checked) {
                    next.add(item.path);
                  } else {
                    next.delete(item.path);
                  }
                  return next;
                })
              }
            />
            <span>
              <strong>{item.path}</strong>
              <small>
                {item.occurrences} occurrence
                {item.occurrences === 1 ? "" : "s"}
              </small>
              <del>{item.beforeSnippet}</del>
              <ins>{item.afterSnippet}</ins>
            </span>
          </label>
        ))}
      </div>

      <footer className="replace-dialog__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !find}
          onClick={() => void preview()}
        >
          Find
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || selectedPaths.size === 0}
          onClick={() => void apply()}
        >
          Replace
        </button>
      </footer>
    </dialog>
  );
}
