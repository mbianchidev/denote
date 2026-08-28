import { FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import type { KnownVaultFile, KnownVaultFileBatch } from "../types";

const MAX_VISIBLE_RESULTS = 200;

interface GlobalSearchDialogProps {
  open: boolean;
  onLoad: () => Promise<KnownVaultFileBatch>;
  onOpen: (file: KnownVaultFile) => Promise<void>;
  onClose: () => void;
}

export function GlobalSearchDialog({
  open,
  onLoad,
  onOpen,
  onClose,
}: GlobalSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const [batch, setBatch] = useState<KnownVaultFileBatch | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else if (!open && dialog.open) {
      requestVersion.current += 1;
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const request = ++requestVersion.current;
    setQuery("");
    setActiveIndex(0);
    setLoading(true);
    setOpening(false);
    setError(null);
    void onLoad()
      .then((files) => {
        if (request === requestVersion.current) {
          setBatch(files);
        }
      })
      .catch((caught) => {
        if (request === requestVersion.current) {
          setError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (request === requestVersion.current) {
          setLoading(false);
        }
      });
  }, [onLoad, open]);

  const results = useMemo(() => {
    const normalized = normalizeFileQuery(query);
    const files =
      normalized && batch
        ? batch.files.filter((file) =>
            normalizeFileQuery(file.fileName).includes(normalized),
          )
        : (batch?.files ?? []);
    return files.slice(0, MAX_VISIBLE_RESULTS);
  }, [batch, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const option = dialogRef.current?.querySelector<HTMLElement>(
      `#global-file-option-${activeIndex}`,
    );
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, results]);

  const openFile = async (file: KnownVaultFile) => {
    setOpening(true);
    setError(null);
    try {
      await onOpen(file);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setOpening(false);
    }
  };

  const activeResult = results[activeIndex] ?? null;
  const busy = loading || opening;

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog global-search-dialog"
      aria-labelledby="global-search-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      onClose={() => {
        if (open && !busy) {
          onClose();
        }
      }}
    >
      <header className="dialog-header global-search-dialog__header">
        <div>
          <h2 id="global-search-title">Open file across vaults</h2>
          <p>Filename search only</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close global file search"
          disabled={busy}
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <label className="global-search-box">
        <Search aria-hidden="true" size={17} />
        <span className="sr-only">Search filenames across vaults</span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search filenames across vaults"
          aria-autocomplete="list"
          aria-controls="global-file-results"
          aria-expanded={results.length > 0}
          aria-activedescendant={
            activeResult ? `global-file-option-${activeIndex}` : undefined
          }
          value={query}
          autoComplete="off"
          placeholder="Type a filename"
          disabled={busy}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % results.length);
            } else if (event.key === "ArrowUp" && results.length > 0) {
              event.preventDefault();
              setActiveIndex(
                (current) => (current - 1 + results.length) % results.length,
              );
            } else if (event.key === "Enter" && activeResult) {
              event.preventDefault();
              void openFile(activeResult);
            }
          }}
        />
        <kbd>{navigator.platform.includes("Mac") ? "⌘P" : "Ctrl+P"}</kbd>
      </label>
      {error ? (
        <p className="global-search-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
      <div
        id="global-file-results"
        className="global-search-results"
        role="listbox"
        aria-label="Matching files"
      >
        {loading ? (
          <p className="dialog-empty">Scanning known vaults…</p>
        ) : results.length > 0 ? (
          results.map((file, index) => (
            <div
              id={`global-file-option-${index}`}
              className="global-search-result"
              role="option"
              aria-selected={index === activeIndex}
              key={`${file.vaultId}:${file.path}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => void openFile(file)}
            >
              <FileText aria-hidden="true" size={16} />
              <span>
                <strong>{file.fileName}</strong>
                <small>
                  {file.vaultName}
                  {file.current ? " · Current vault" : ""}
                  {file.default ? " · Built-in guide" : ""}
                </small>
              </span>
              <code>{file.path}</code>
            </div>
          ))
        ) : (
          <p className="dialog-empty">
            {query ? "No filenames match." : "No files found in known vaults."}
          </p>
        )}
      </div>
      {batch &&
      (batch.truncated ||
        batch.skippedVaultCount > 0 ||
        batch.skippedEntryCount > 0 ||
        batch.files.length > MAX_VISIBLE_RESULTS) ? (
        <footer className="global-search-dialog__status">
          {batch.truncated
            ? "Results limited to 25,000 files."
            : batch.files.length > MAX_VISIBLE_RESULTS
              ? `Showing the first ${MAX_VISIBLE_RESULTS} matches.`
              : null}
          {batch.skippedVaultCount > 0
            ? ` ${batch.skippedVaultCount} unavailable vaults skipped.`
            : null}
          {batch.skippedEntryCount > 0
            ? ` ${batch.skippedEntryCount} unreadable entries skipped.`
            : null}
        </footer>
      ) : null}
    </dialog>
  );
}

function normalizeFileQuery(value: string): string {
  return value.normalize("NFC").toLowerCase().trim();
}
