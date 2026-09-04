import {
  Check,
  CloudDownload,
  GitBranch,
  GitBranchPlus,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
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

function SourceControlBranchPickerComponent({
  branches,
  currentBranch,
  busy,
  onAction,
}: SourceControlBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [startPoint, setStartPoint] = useState(currentBranch);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
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

  const run = (action: PluginSourceControlAction) => {
    setOpen(false);
    setQuery("");
    setEditing(null);
    setNewName("");
    onAction(action);
  };

  return (
    <section className="source-control-branch-picker">
      <button
        type="button"
        className="source-control__branch-trigger"
        aria-label={`Branch: ${currentBranch || "none"}`}
        aria-expanded={open}
        disabled={busy || branches.length === 0}
        onClick={() => {
          setStartPoint(currentBranch || branches[0]?.name || "");
          setOpen((value) => !value);
        }}
      >
        <GitBranch aria-hidden="true" size={15} />
        <span>{currentBranch || "Select branch"}</span>
      </button>
      {open ? (
        <div className="source-control-branch-picker__panel">
          <label className="source-control-branch-picker__search">
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
          <ul aria-label="Local and remote branches">
            {filtered.map((branch) => {
              const key = `${branch.remote ? "remote" : "local"}:${branch.name}`;
              const localName = localBranchNameFor(branch.name);
              const editingThis = editing === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="source-control-branch-picker__choice"
                    aria-label={
                      branch.current
                        ? `Switch to ${branch.name}`
                        : branch.remote
                          ? `Check out ${branch.name} as ${localName}`
                          : `Switch to ${branch.name}`
                    }

                    disabled={busy || branch.current || !localName}
                    onClick={() =>
                      run(
                        branch.remote
                          ? {
                              id: "checkout-remote-branch",
                              values: {
                                remoteBranch: branch.name,
                                localName,
                                from: currentBranch,
                              },
                            }
                          : {
                              id: "switch-branch",
                              values: {
                                branch: branch.name,
                                from: currentBranch,
                              },
                            },
                      )
                    }
                  >
                    {branch.current ? (
                      <Check aria-hidden="true" size={15} />
                    ) : branch.remote ? (
                      <CloudDownload aria-hidden="true" size={15} />
                    ) : (
                      <GitBranch aria-hidden="true" size={15} />
                    )}
                    <span>
                      <strong>{branch.name}</strong>
                      <small>
                        {branch.remote ? "Remote" : "Local"}
                        {branch.current ? " · current" : ""}
                        {` · ${branch.ahead} ahead, ${branch.behind} behind`}
                      </small>
                    </span>
                  </button>
                  <div className="source-control-branch-picker__actions">
                    <button
                      type="button"
                      aria-label={`Edit branch ${branch.name}`}
                      title={`Rename ${branch.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(key);
                        setNewName(
                          branch.remote ? localBranchNameFor(branch.name) : branch.name,
                        );
                      }}
                    >
                      <Pencil aria-hidden="true" size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${branch.name}`}
                      title={`Delete ${branch.name}`}
                      disabled={busy || branch.current}
                      onClick={() =>
                        run({
                          id: branch.remote
                            ? "delete-remote-branch"
                            : "delete-branch",
                          values: { name: branch.name },
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </div>
                  {editingThis ? (
                    <form
                      className="source-control-branch-picker__rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = newName.trim();
                        if (!trimmed) {
                          return;
                        }
                        run({
                          id: branch.remote
                            ? "rename-remote-branch"
                            : "rename-branch",
                          values: {
                            name: branch.name,
                            newName: trimmed,
                          },
                        });
                      }}
                    >
                      <label>
                        <span className="sr-only">New name for {branch.name}</span>
                        <input
                          value={newName}
                          autoFocus
                          disabled={busy}
                          onChange={(event) =>
                            setNewName(event.currentTarget.value)
                          }
                        />
                      </label>
                      <button
                        type="submit"
                        className="secondary-button"
                        aria-label={`Rename ${branch.name}`}
                        disabled={
                          busy ||
                          !newName.trim() ||
                          newName.trim() === branch.name
                        }
                      >
                        Rename
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {createName && !exactBranch ? (
            <section
              className="source-control-branch-picker__create"
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
                      {branch.name} ({branch.remote ? "remote" : "local"})
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
                Create and switch
              </button>
            </section>
          ) : null}
          {filtered.length === 0 && !createName ? (
            <p className="sidebar-empty">No branches found.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function localBranchNameFor(remoteBranch: string): string {
  const separator = remoteBranch.indexOf("/");
  return separator === -1 ? remoteBranch : remoteBranch.slice(separator + 1);
}

export const SourceControlBranchPicker = memo(
  SourceControlBranchPickerComponent,
);
