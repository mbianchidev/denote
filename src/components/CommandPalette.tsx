import {
  ArrowLeft,
  Command as CommandIcon,
  FileText,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import type { KnownVaultFile, KnownVaultFileBatch } from "../types";

const MAX_VISIBLE_RESULTS = 200;

export interface CommandPaletteCommand {
  id: string;
  title: string;
  description: string;
  category: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  kind?: "action" | "file-search";
  run?: () => void | Promise<void>;
}

interface CommandPaletteProps {
  open: boolean;
  commands: CommandPaletteCommand[];
  onLoadFiles: () => Promise<KnownVaultFileBatch>;
  onOpenFile: (file: KnownVaultFile) => Promise<void>;
  onCommandError: (error: unknown) => void;
  onClose: () => void;
}

type PaletteResult =
  | { type: "command"; command: CommandPaletteCommand }
  | { type: "file"; file: KnownVaultFile };

export function CommandPalette({
  open,
  commands,
  onLoadFiles,
  onOpenFile,
  onCommandError,
  onClose,
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const [batch, setBatch] = useState<KnownVaultFileBatch | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [filesOnly, setFilesOnly] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
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
    setFilesOnly(false);
    setBatch(null);
    setLoadingFiles(true);
    setOpeningFile(false);
    setError(null);
    void onLoadFiles()
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
          setLoadingFiles(false);
        }
      });
  }, [onLoadFiles, open]);

  const results = useMemo(() => {
    if (!open) {
      return [];
    }
    const normalized = normalizeFileQuery(query);
    const matchingCommands = filesOnly
      ? []
      : commands.filter((command) => {
          if (!normalized) {
            return true;
          }
          return normalizeFileQuery(
            [
              command.title,
              command.description,
              command.category,
              ...(command.keywords ?? []),
            ].join(" "),
          ).includes(normalized);
        });
    const commandResults = matchingCommands
      .slice(0, MAX_VISIBLE_RESULTS)
      .map((command): PaletteResult => ({ type: "command", command }));
    const fileResults: PaletteResult[] = [];
    const remaining = MAX_VISIBLE_RESULTS - commandResults.length;
    if ((filesOnly || normalized) && batch && remaining > 0) {
      for (const file of batch.files) {
        if (normalizeFileQuery(file.fileName).includes(normalized)) {
          fileResults.push({ type: "file", file });
          if (fileResults.length >= remaining) {
            break;
          }
        }
      }
    }
    return [...commandResults, ...fileResults];
  }, [batch, commands, filesOnly, open, query]);
  const resultsKey = results
    .map((result) =>
      result.type === "command"
        ? `command:${result.command.id}:${result.command.disabled === true}`
        : `file:${result.file.vaultId}:${result.file.path}`,
    )
    .join("\u0000");

  useEffect(() => {
    setActiveIndex(firstSelectableIndex(results));
  }, [filesOnly, query, resultsKey]);

  useEffect(() => {
    const option = dialogRef.current?.querySelector<HTMLElement>(
      `#command-palette-option-${activeIndex}`,
    );
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, results]);

  const openFile = async (file: KnownVaultFile) => {
    setOpeningFile(true);
    setError(null);
    try {
      await onOpenFile(file);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setOpeningFile(false);
    }
  };

  const runCommand = (command: CommandPaletteCommand) => {
    if (command.disabled) {
      return;
    }
    if (command.kind === "file-search") {
      setFilesOnly(true);
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    onClose();
    window.setTimeout(() => {
      try {
        void Promise.resolve(command.run?.()).catch(onCommandError);
      } catch (caught) {
        onCommandError(caught);
      }
    }, 0);
  };

  const selectResult = (result: PaletteResult) => {
    if (result.type === "command") {
      runCommand(result.command);
    } else {
      void openFile(result.file);
    }
  };

  const moveActive = (direction: -1 | 1) => {
    if (results.length === 0) {
      return;
    }
    let next = activeIndex;
    for (let count = 0; count < results.length; count += 1) {
      next = (next + direction + results.length) % results.length;
      if (isSelectable(results[next])) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const activeResult = results[activeIndex] ?? null;
  const busy = openingFile;

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog command-palette"
      aria-labelledby="command-palette-title"
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
      <header className="dialog-header command-palette__header">
        <div>
          <h2 id="command-palette-title">Command palette</h2>
          <p>Commands and filename-only search across known vaults</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close command palette"
          disabled={busy}
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div className="command-palette__search">
        {filesOnly ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Back to all commands"
            disabled={busy}
            onClick={() => {
              setFilesOnly(false);
              setQuery("");
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <ArrowLeft aria-hidden="true" size={15} />
          </button>
        ) : (
          <Search aria-hidden="true" size={17} />
        )}
        <span className="sr-only">
          {filesOnly
            ? "Search filenames across vaults"
            : "Search commands or filenames across vaults"}
        </span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label={
            filesOnly
              ? "Search filenames across vaults"
              : "Search commands or filenames across vaults"
          }
          aria-autocomplete="list"
          aria-controls="command-palette-results"
          aria-expanded={results.length > 0}
          aria-activedescendant={
            activeResult
              ? `command-palette-option-${activeIndex}`
              : undefined
          }
          value={query}
          autoComplete="off"
          placeholder={filesOnly ? "Type a filename" : "Type a command or filename"}
          disabled={busy}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              moveActive(1);
            } else if (event.key === "ArrowUp" && results.length > 0) {
              event.preventDefault();
              moveActive(-1);
            } else if (event.key === "Enter" && activeResult) {
              event.preventDefault();
              selectResult(activeResult);
            } else if (
              filesOnly &&
              !query &&
              (event.key === "Backspace" || event.key === "Escape")
            ) {
              event.preventDefault();
              event.stopPropagation();
              setFilesOnly(false);
            }
          }}
        />
        <kbd>{navigator.platform.includes("Mac") ? "⌘P" : "Ctrl+P"}</kbd>
      </div>
      {error ? (
        <p className="command-palette__error" role="alert">
          {error}
        </p>
      ) : null}
      <div
        id="command-palette-results"
        className="command-palette__results"
        role="listbox"
        aria-label="Matching commands and files"
      >
        {results.length > 0 ? (
          results.map((result, index) =>
            result.type === "command" ? (
              <div
                id={`command-palette-option-${index}`}
                className="command-palette__result"
                data-result-type="command"
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={result.command.disabled === true}
                key={`command:${result.command.id}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  if (!result.command.disabled) {
                    setActiveIndex(index);
                  }
                }}
                onClick={() => runCommand(result.command)}
              >
                <CommandIcon aria-hidden="true" size={16} />
                <span>
                  <strong>{result.command.title}</strong>
                  <small>
                    {result.command.category} · {result.command.description}
                  </small>
                </span>
                {result.command.shortcut ? (
                  <kbd>{result.command.shortcut}</kbd>
                ) : null}
              </div>
            ) : (
            <div
              id={`command-palette-option-${index}`}
              className="command-palette__result"
              data-result-type="file"
              role="option"
              aria-selected={index === activeIndex}
              key={`file:${result.file.vaultId}:${result.file.path}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => void openFile(result.file)}
            >
              <FileText aria-hidden="true" size={16} />
              <span>
                <strong>{result.file.fileName}</strong>
                <small>
                  {result.file.vaultName}
                  {result.file.current ? " · Current vault" : ""}
                  {result.file.default ? " · Built-in guide" : ""}
                </small>
              </span>
              <code>{result.file.path}</code>
            </div>
            ),
          )
        ) : (
          <p className="dialog-empty">
            {loadingFiles
              ? "Scanning known vaults…"
              : query
                ? "No commands or filenames match."
                : filesOnly
                  ? "No files found in known vaults."
                  : "No commands available."}
          </p>
        )}
      </div>
      {loadingFiles ||
      (batch &&
        (batch.truncated ||
          batch.skippedVaultCount > 0 ||
          batch.skippedEntryCount > 0 ||
          batch.files.length > MAX_VISIBLE_RESULTS)) ? (
        <footer className="command-palette__status">
          {loadingFiles ? "Scanning known vaults…" : null}
          {batch?.truncated
            ? "Results limited to 25,000 files."
            : (batch?.files.length ?? 0) > MAX_VISIBLE_RESULTS
              ? `Showing the first ${MAX_VISIBLE_RESULTS} matches.`
              : null}
          {(batch?.skippedVaultCount ?? 0) > 0
            ? ` ${batch?.skippedVaultCount} unavailable vaults skipped.`
            : null}
          {(batch?.skippedEntryCount ?? 0) > 0
            ? ` ${batch?.skippedEntryCount} unreadable entries skipped.`
            : null}
        </footer>
      ) : null}
    </dialog>
  );
}

function normalizeFileQuery(value: string): string {
  return value.normalize("NFC").toLowerCase().trim();
}

function isSelectable(result: PaletteResult | undefined): boolean {
  return (
    result !== undefined &&
    (result.type === "file" || result.command.disabled !== true)
  );
}

function firstSelectableIndex(results: PaletteResult[]): number {
  return results.findIndex(isSelectable);
}
