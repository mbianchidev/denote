import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  PluginSourceControlAction,
  PluginSourceControlDiffFile,
  PluginSourceControlResourceGroup,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";

interface SourceControlPanelProps {
  title: string;
  model: PluginSourceControlViewModel;
  onAction: (action: PluginSourceControlAction) => void;
}

const tabs = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" },
] as const;

type SourceControlTab = (typeof tabs)[number]["id"];

function action(
  id: string,
  values?: PluginSourceControlAction["values"],
): PluginSourceControlAction {
  return values ? { id, values } : { id };
}

function ResourceGroup({
  group,
  busy,
  onAction,
}: {
  group: PluginSourceControlResourceGroup;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  if (group.resources.length === 0) {
    return null;
  }

  return (
    <section className="source-control__resource-group">
      <h4>
        {group.label} <span>{group.resources.length}</span>
      </h4>
      <ul>
        {group.resources.map((resource) => (
          <li key={`${group.kind}:${resource.path}`}>
            <div className="source-control__resource-summary">
              <strong>{resource.path}</strong>
              <span>
                {resource.status}
                {resource.binary
                  ? " · binary"
                  : ` · +${resource.additions} −${resource.deletions}`}
              </span>
            </div>
            <div className="source-control__row-actions">
              {group.kind === "staged" ? (
                <button
                  type="button"
                  aria-label={`Unstage ${resource.path}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(action("unstage", { path: resource.path }))
                  }
                >
                  Unstage
                </button>
              ) : group.kind !== "ignored" ? (
                <button
                  type="button"
                  aria-label={`Stage ${resource.path}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(action("stage", { path: resource.path }))
                  }
                >
                  Stage
                </button>
              ) : null}
              {group.kind !== "ignored" ? (
                <button
                  type="button"
                  aria-label={`Open diff for ${resource.path}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(action("open-diff", { path: resource.path }))
                  }
                >
                  Open diff
                </button>
              ) : null}
              {group.kind === "conflicted" ? (
                <button
                  type="button"
                  aria-label={`Open conflict for ${resource.path}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(action("open-conflict", { path: resource.path }))
                  }
                >
                  Open conflict
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DiffView({ files }: { files: PluginSourceControlDiffFile[] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <section className="source-control__detail" aria-labelledby="source-control-diff">
      <h3 id="source-control-diff">Diff</h3>
      {files.map((file) => (
        <article className="source-control__diff-file" key={file.path}>
          <h4>{file.path}</h4>
          {file.previousPath ? <p>Previously {file.previousPath}</p> : null}
          <p>
            {file.status} · +{file.additions} −{file.deletions}
          </p>
          {file.binary ? (
            <p className="source-control__limitation" role="status">
              Binary diff content cannot be displayed in Denote.
            </p>
          ) : (
            file.hunks.map((hunk, index) => (
              <section
                className="source-control__diff-hunk"
                key={`${hunk.header}:${index}`}
                aria-label={hunk.header}
              >
                <h5>{hunk.header}</h5>
                <ol>
                  {hunk.lines.map((line, lineIndex) => (
                    <li
                      key={`${line.oldLineNumber}:${line.newLineNumber}:${lineIndex}`}
                      data-kind={line.kind}
                    >
                      <span className="sr-only">
                        {line.kind}
                        {line.oldLineNumber === null
                          ? ""
                          : `, old line ${line.oldLineNumber}`}
                        {line.newLineNumber === null
                          ? ""
                          : `, new line ${line.newLineNumber}`}
                        {": "}
                      </span>
                      <span aria-hidden="true">
                        {line.oldLineNumber ?? " "}
                      </span>
                      <span aria-hidden="true">
                        {line.newLineNumber ?? " "}
                      </span>
                      <code>{line.content}</code>
                    </li>
                  ))}
                </ol>
              </section>
            ))
          )}
        </article>
      ))}
    </section>
  );
}

export function SourceControlPanel({
  title,
  model,
  onAction,
}: SourceControlPanelProps) {
  const { repository } = model;
  const [commitMessage, setCommitMessage] = useState("");
  const tabRefs = useRef(new Map<SourceControlTab, HTMLButtonElement>());
  const selectedBranch =
    model.branches.find((branch) => branch.current)?.name ??
    repository.branch ??
    "";
  const branchOptions =
    selectedBranch &&
    !model.branches.some((branch) => branch.name === selectedBranch)
      ? [
          {
            name: selectedBranch,
            current: true,
            remote: false,
            upstream: repository.upstream,
            ahead: repository.ahead,
            behind: repository.behind,
          },
          ...model.branches,
        ]
      : model.branches;
  const stagedChanges =
    model.resourceGroups.find((group) => group.kind === "staged")?.resources
      .length ?? 0;
  const selectedConflictPath =
    model.selectedView.kind === "conflict" ? model.selectedView.path : null;
  const selectedConflict =
    selectedConflictPath
      ? model.conflicts.find(
          (conflict) => conflict.path === selectedConflictPath,
        ) ?? null
      : null;
  const selectedConflictIsBinary =
    selectedConflict !== null &&
    (model.resourceGroups.some((group) =>
      group.resources.some(
        (resource) =>
          resource.path === selectedConflict.path && resource.binary,
      ),
    ) ||
      model.diffFiles.some(
        (file) => file.path === selectedConflict.path && file.binary,
      ));
  const retryActionId =
    model.recovery.state === "failed"
      ? model.recovery.retryActionId
      : undefined;
  const dismissActionId =
    model.recovery.state === "failed"
      ? model.recovery.dismissActionId
      : undefined;
  // A running operation is cancellable only while the provider reports the ID
  // the cancel action has to return to it.
  const cancellableOperationId = repository.busy
    ? repository.activeOperationId
    : undefined;

  useEffect(() => {
    setCommitMessage("");
  }, [repository.repositoryId]);

  const selectTab = (tab: SourceControlTab) => {
    onAction(action("select-tab", { tab }));
  };

  const moveTabFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    tabRefs.current.get(nextTab)?.focus();
    selectTab(nextTab);
  };

  return (
    <div className="sidebar-view source-control">
      <div className="sidebar-view__title">
        <h2>{title}</h2>
        <button
          type="button"
          className="source-control__compact-action"
          disabled={repository.busy}
          onClick={() => onAction(action("refresh"))}
        >
          Refresh
        </button>
      </div>
      <div className="source-control__content">
        <section
          className="source-control__repository"
          aria-labelledby="source-control-repository"
        >
          <h3 id="source-control-repository">{repository.label}</h3>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{repository.initialized ? "Initialized" : "Not initialized"}</dd>
            </div>
            <div>
              <dt>Upstream</dt>
              <dd>{repository.upstream ?? "None"}</dd>
            </div>
            <div>
              <dt>Sync</dt>
              <dd>
                {repository.ahead} ahead, {repository.behind} behind
              </dd>
            </div>
          </dl>
          {repository.latestCommit ? (
            <p>
              Latest: <strong>{repository.latestCommit.summary}</strong>{" "}
              <span>({repository.latestCommit.shortId})</span>
            </p>
          ) : null}
          <label className="source-control__field">
            <span>Branch</span>
            <select
              value={selectedBranch}
              disabled={repository.busy || branchOptions.length === 0}
              onChange={(event) =>
                onAction(
                  action("switch-branch", { branch: event.currentTarget.value }),
                )
              }
            >
              {!selectedBranch && branchOptions.length > 0 ? (
                <option value="" disabled>
                  Select a branch
                </option>
              ) : null}
              {branchOptions.length === 0 ? (
                <option value="">No branches</option>
              ) : (
                branchOptions.map((branch) => (
                  <option
                    value={branch.name}
                    key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
                  >
                    {branch.name}
                    {branch.remote ? " (remote)" : ""}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="source-control__actions">
            {!repository.initialized ? (
              <button
                type="button"
                className="primary-button"
                disabled={repository.busy}
                onClick={() => onAction(action("initialize"))}
              >
                Initialize repository
              </button>
            ) : (
              <>
                {model.remotes.length > 0 ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={repository.busy}
                    onClick={() => onAction(action("fetch"))}
                  >
                    Fetch
                  </button>
                ) : null}
                {repository.upstream || model.remotes.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={repository.busy}
                      onClick={() => onAction(action("pull"))}
                    >
                      Pull
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={repository.busy}
                      onClick={() => onAction(action("push"))}
                    >
                      Push
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>
          {repository.busy ? (
            <p className="source-control__status" role="status">
              {repository.busyMessage ?? "Source control operation in progress"}
            </p>
          ) : null}
          {repository.busy && cancellableOperationId ? (
            <div className="source-control__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  onAction(
                    action("cancel-operation", {
                      operationId: cancellableOperationId,
                    }),
                  )
                }
              >
                Cancel operation
              </button>
            </div>
          ) : null}
        </section>

        {repository.initialized ? (
          <>
            <div
              className="source-control__tabs"
              role="tablist"
              aria-label="Source control sections"
            >
              {tabs.map((tab, index) => (
                <button
                  type="button"
                  role="tab"
                  id={`source-control-tab-${tab.id}`}
                  aria-controls={`source-control-panel-${tab.id}`}
                  aria-selected={model.selectedTab === tab.id}
                  tabIndex={model.selectedTab === tab.id ? 0 : -1}
                  key={tab.id}
                  ref={(node) => {
                    if (node) {
                      tabRefs.current.set(tab.id, node);
                    } else {
                      tabRefs.current.delete(tab.id);
                    }
                  }}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => moveTabFocus(event, index)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              id={`source-control-panel-${model.selectedTab}`}
              role="tabpanel"
              aria-labelledby={`source-control-tab-${model.selectedTab}`}
              className="source-control__tab-panel"
            >
              {model.selectedTab === "changes" ? (
                <>
                  <form
                    className="source-control__commit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const message = commitMessage.trim();
                      if (!message) {
                        return;
                      }
                      onAction(action("commit", { message }));
                    }}
                  >
                    <label className="source-control__field">
                      <span>Commit message</span>
                      <input
                        value={commitMessage}
                        disabled={repository.busy}
                        onChange={(event) =>
                          setCommitMessage(event.currentTarget.value)
                        }
                      />
                    </label>
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={
                        repository.busy ||
                        stagedChanges === 0 ||
                        commitMessage.trim().length === 0
                      }
                    >
                      Commit staged changes
                    </button>
                  </form>
                  {model.resourceGroups.some(
                    (group) => group.resources.length > 0,
                  ) ? (
                    model.resourceGroups.map((group) => (
                      <ResourceGroup
                        key={group.kind}
                        group={group}
                        busy={repository.busy}
                        onAction={onAction}
                      />
                    ))
                  ) : (
                    <p className="sidebar-empty">No working tree changes.</p>
                  )}
                  {selectedConflict ? (
                    <section
                      className="source-control__detail"
                      aria-labelledby="source-control-conflict"
                    >
                      <h3 id="source-control-conflict">
                        Conflict: {selectedConflict.path}
                      </h3>
                      <dl>
                        <div>
                          <dt>Ours</dt>
                          <dd>{selectedConflict.oursLabel}</dd>
                        </div>
                        <div>
                          <dt>Theirs</dt>
                          <dd>{selectedConflict.theirsLabel}</dd>
                        </div>
                        {selectedConflict.baseLabel ? (
                          <div>
                            <dt>Base</dt>
                            <dd>{selectedConflict.baseLabel}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {selectedConflictIsBinary ? (
                        <p className="source-control__limitation" role="status">
                          This is a binary conflict. Denote cannot display or
                          merge its contents; use the provider&apos;s supported
                          external conflict workflow.
                        </p>
                      ) : null}
                    </section>
                  ) : null}
                  <DiffView files={model.diffFiles} />
                </>
              ) : model.selectedTab === "history" ? (
                <>
                  {model.history.length > 0 ? (
                    <ul className="source-control__history">
                      {model.history.map((entry) => {
                        const selected =
                          "commitId" in model.selectedView &&
                          model.selectedView.commitId === entry.id;
                        return (
                          <li key={entry.id}>
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() =>
                                onAction(
                                  action("open-commit", {
                                    commitId: entry.id,
                                  }),
                                )
                              }
                            >
                              <strong>{entry.summary}</strong>
                              <span>
                                {entry.shortId} · {entry.authorName}
                              </span>
                              <time dateTime={entry.authoredAt}>
                                {entry.authoredAt}
                              </time>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="sidebar-empty">No commit history.</p>
                  )}
                  <DiffView files={model.diffFiles} />
                </>
              ) : (
                <div className="source-control__branch-lists">
                  <section>
                    <h3>Branches</h3>
                    {model.branches.length > 0 ? (
                      <ul>
                        {model.branches.map((branch) => (
                          <li
                            key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
                          >
                            <button
                              type="button"
                              aria-pressed={branch.current}
                              disabled={repository.busy || branch.current}
                              onClick={() =>
                                onAction(
                                  action("switch-branch", {
                                    branch: branch.name,
                                  }),
                                )
                              }
                            >
                              <strong>{branch.name}</strong>
                              <span>
                                {branch.remote ? "Remote" : "Local"} ·{" "}
                                {branch.ahead} ahead, {branch.behind} behind
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="sidebar-empty">No branches.</p>
                    )}
                  </section>
                  <section>
                    <h3>Remotes</h3>
                    {model.remotes.length > 0 ? (
                      <ul className="source-control__remotes">
                        {model.remotes.map((remote) => (
                          <li key={remote.name}>
                            <strong>{remote.name}</strong>
                            <span>Fetch: {remote.fetchUrl ?? "Unavailable"}</span>
                            <span>Push: {remote.pushUrl ?? "Unavailable"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="sidebar-empty">No remotes.</p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </>
        ) : null}

        {model.recovery.state !== "idle" ? (
          <section
            className="source-control__recovery"
            aria-labelledby="source-control-recovery"
          >
            <h3 id="source-control-recovery">Recovery</h3>
            <p role="status">{model.recovery.message}</p>
            <div className="source-control__actions">
              {model.recovery.state === "running" ? (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAction(action("continue"))}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onAction(action("skip"))}
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onAction(action("abort"))}
                  >
                    Abort
                  </button>
                </>
              ) : (
                <>
                  {retryActionId ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => onAction(action(retryActionId))}
                    >
                      Retry
                    </button>
                  ) : null}
                  {dismissActionId ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onAction(action(dismissActionId))}
                    >
                      Dismiss
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
