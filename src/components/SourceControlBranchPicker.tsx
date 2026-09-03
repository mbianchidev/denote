import {
  Check,
  CloudDownload,
  GitBranch,
  GitBranchPlus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PluginSourceControlAction,
  PluginSourceControlBranchChoice,
} from "@denote/plugin-sdk";

interface SourceControlBranchPickerProps {
  branches: PluginSourceControlBranchChoice[];
  currentBranch: string;
  busy: boolean;
  onAction: (action: PluginSourceControlAction) => void;
}

export function SourceControlBranchPicker({
  branches,
  currentBranch,
  busy,
  onAction,
}: SourceControlBranchPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [startPoint, setStartPoint] = useState(currentBranch);
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      branches.filter(
        (branch) =>
          !normalized ||
          branch.name.toLocaleLowerCase().includes(normalized),
      ),
    [branches, normalized],
  );
  const createName = query.trim();
  const exactBranch = branches.some(
    (branch) =>
      branch.name.toLocaleLowerCase() === createName.toLocaleLowerCase(),
  );
  const createFrom =
    startPoint && branches.some((branch) => branch.name === startPoint)
      ? startPoint
      : currentBranch || branches[0]?.name || "";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      window.setTimeout(() => dialog.querySelector("input")?.focus(), 0);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setStartPoint(currentBranch);
  };
  const run = (action: PluginSourceControlAction) => {
    close();
    onAction(action);
  };

  return (
    <>
      <button
        type="button"
        className="source-control__branch-trigger"
        aria-label={`Branch: ${currentBranch || "none"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={busy || branches.length === 0}
        onClick={() => {
          setStartPoint(currentBranch || branches[0]?.name || "");
          setOpen(true);
        }}
      >
        <GitBranch aria-hidden="true" size={15} />
        <span>{currentBranch || "Select branch"}</span>
      </button>
      <dialog
        ref={dialogRef}
        className="app-dialog source-control-branch-dialog"
        aria-labelledby="source-control-branch-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) {
            close();
          }
        }}
        onClose={() => {
          if (open) {
            close();
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="source-control-branch-dialog-title">Switch or create branch</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close branch picker"
            disabled={busy}
            onClick={close}
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <div className="source-control-branch-dialog__body">
          <label className="source-control-branch-dialog__search">
            <Search aria-hidden="true" size={15} />
            <span className="sr-only">Find or create branch</span>
            <input
              type="search"
              value={query}
              placeholder="Find or create a branch"
              disabled={busy}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          {createName && !exactBranch ? (
            <section
              className="source-control-branch-dialog__create"
              aria-label="Create branch"
            >
              <label>
                <span>Create from</span>
                <select
                  value={createFrom}
                  disabled={busy}
                  onChange={(event) => setStartPoint(event.currentTarget.value)}
                >
                  {branches.map((branch) => (
                    <option
                      key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
                      value={branch.name}
                    >
                      {branch.name}
                      {branch.remote ? " (remote)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary-button"
                aria-label={`Create ${createName} from ${createFrom} and switch`}
                disabled={busy || !createFrom}
                onClick={() =>
                  run({
                    id: "create-branch",
                    values: {
                      name: createName,
                      startPoint: createFrom,
                      checkout: true,
                      from: currentBranch,
                    },
                  })
                }
              >
                <GitBranchPlus aria-hidden="true" size={15} />
                Create “{createName}” from {createFrom}
              </button>
            </section>
          ) : null}
          <section aria-labelledby="source-control-local-branches">
            <h3 id="source-control-local-branches">Local branches</h3>
            <ul>
              {filtered
                .filter((branch) => !branch.remote)
                .map((branch) => (
                  <li key={branch.name}>
                    <button
                      type="button"
                      aria-label={
                        branch.current
                          ? `Current branch ${branch.name}`
                          : `Switch to ${branch.name}`
                      }
                      disabled={busy || branch.current}
                      onClick={() =>
                        run({
                          id: "switch-branch",
                          values: {
                            branch: branch.name,
                            from: currentBranch,
                          },
                        })
                      }
                    >
                      {branch.current ? (
                        <Check aria-hidden="true" size={15} />
                      ) : (
                        <GitBranch aria-hidden="true" size={15} />
                      )}
                      <span>
                        <strong>{branch.name}</strong>
                        <small>
                          {branch.current
                            ? "Current branch"
                            : `${branch.ahead} ahead, ${branch.behind} behind`}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
          <section aria-labelledby="source-control-remote-branches">
            <h3 id="source-control-remote-branches">Remote branches</h3>
            <ul>
              {filtered
                .filter((branch) => branch.remote)
                .map((branch) => {
                  const localName = localBranchNameFor(branch.name);
                  return (
                    <li key={branch.name}>
                      <button
                        type="button"
                        aria-label={`Check out ${branch.name} as ${localName}`}
                        disabled={busy || !localName}
                        onClick={() =>
                          run({
                            id: "checkout-remote-branch",
                            values: {
                              remoteBranch: branch.name,
                              localName,
                              from: currentBranch,
                            },
                          })
                        }
                      >
                        <CloudDownload aria-hidden="true" size={15} />
                        <span>
                          <strong>{branch.name}</strong>
                          <small>Check out as {localName}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
          {filtered.length === 0 && !createName ? (
            <p className="dialog-empty">No branches found.</p>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

function localBranchNameFor(remoteBranch: string): string {
  const separator = remoteBranch.indexOf("/");
  return separator === -1 ? remoteBranch : remoteBranch.slice(separator + 1);
}
