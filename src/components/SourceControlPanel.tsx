import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  PluginSourceControlAction,
  PluginSourceControlAuthMode,
  PluginSourceControlBranchChoice,
  PluginSourceControlCommitDetail,
  PluginSourceControlDiffFile,
  PluginSourceControlDiffSource,
  PluginSourceControlHistoryPage,
  PluginSourceControlPendingBranchSwitch,
  PluginSourceControlRemote,
  PluginSourceControlRemoteAccess,
  PluginSourceControlResourceGroup,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";

interface SourceControlPanelProps {
  title: string;
  model: PluginSourceControlViewModel;
  onAction: (action: PluginSourceControlAction) => void;
  /**
   * Opens one repository-relative path in the editor.
   *
   * The host owns this entirely: it resolves the path inside the open vault
   * and uses the ordinary file-open flow, so no provider ever names a place on
   * disk and no Git command is involved in opening a note.
   */
  onOpenFile?: (path: string) => void;
}

const tabs = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" },
] as const;

type SourceControlTab = (typeof tabs)[number]["id"];

const authModeLabels: Record<PluginSourceControlAuthMode, string> = {
  public: "Public repository",
  "ssh-agent": "SSH agent",
  "github-https": "GitHub sign-in",
};

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
  onOpenDiff,
  onOpenFile,
}: {
  group: PluginSourceControlResourceGroup;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
  onOpenDiff: (path: string, group: string) => void;
  onOpenFile?: (path: string) => void;
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
              {group.kind === "staged" || group.kind === "unstaged" ? (
                <button
                  type="button"
                  aria-label={`Open diff for ${resource.path}`}
                  disabled={busy}
                  onClick={() => onOpenDiff(resource.path, group.kind)}
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
              {/* A deleted file is still worth reviewing, but there is nothing
                  left on disk to open. */}
              {onOpenFile && resource.status !== "deleted" ? (
                <button
                  type="button"
                  aria-label={`Open file ${resource.path}`}
                  onClick={() => onOpenFile(resource.path)}
                >
                  Open file
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Whether one file may be staged a hunk at a time.
 *
 * Only an ordinary modification of a tracked text file qualifies: a rename, a
 * copy, an addition, a deletion, and binary content have no pair of matching
 * text sides for a single-path patch to describe.
 */
function supportsHunkActions(file: PluginSourceControlDiffFile): boolean {
  return (
    !file.binary && file.status === "modified" && file.previousPath === null
  );
}

function DiffView({
  files,
  source,
  busy,
  headingId,
  label,
  emptyMessage,
  onAction,
  onOpenFile,
  onClose,
}: {
  files: PluginSourceControlDiffFile[];
  /**
   * Which comparison produced these files. Hunk actions are offered only for
   * the two working-tree directions the host can apply a patch in; a commit's
   * diff is history and is read-only.
   */
  source: PluginSourceControlDiffSource | null;
  busy: boolean;
  headingId: string;
  label: string;
  emptyMessage?: string;
  onAction: SourceControlPanelProps["onAction"];
  onOpenFile?: (path: string) => void;
  onClose?: () => void;
}) {
  const staged = source?.kind === "index";
  const stageable = source?.kind === "worktree" || source?.kind === "index";

  if (files.length === 0) {
    return emptyMessage ? (
      <section className="source-control__detail" aria-labelledby={headingId}>
        <h3 id={headingId}>{label}</h3>
        <p className="sidebar-empty">{emptyMessage}</p>
      </section>
    ) : null;
  }

  return (
    <section className="source-control__detail" aria-labelledby={headingId}>
      <h3 id={headingId}>{label}</h3>
      {files.map((file) => (
        <article className="source-control__diff-file" key={file.path}>
          <h4>{file.path}</h4>
          {file.previousPath ? <p>Previously {file.previousPath}</p> : null}
          <p>
            {file.status} · +{file.additions} −{file.deletions}
          </p>
          {onOpenFile && file.status !== "deleted" ? (
            <div className="source-control__row-actions">
              <button
                type="button"
                aria-label={`Open file ${file.path}`}
                onClick={() => onOpenFile(file.path)}
              >
                Open file
              </button>
            </div>
          ) : null}
          {file.status === "deleted" ? (
            <p className="source-control__limitation" role="status">
              This file was deleted, so there is nothing left in the vault to
              open. Its change is still shown here.
            </p>
          ) : null}
          {file.binary ? (
            <p className="source-control__limitation" role="status">
              Binary content cannot be displayed in Denote, so this change has
              no line-level content. An encrypted vault records ciphertext,
              which Git also reports as binary.
            </p>
          ) : (
            <>
              {stageable && !supportsHunkActions(file) ? (
                <p className="source-control__limitation" role="status">
                  Denote stages this change as a whole file, because a{" "}
                  {file.status} change has no matching pair of text sides to
                  split into hunks.
                </p>
              ) : null}
              {file.hunks.map((hunk, index) => (
                <section
                  className="source-control__diff-hunk"
                  key={`${hunk.header}:${index}`}
                  aria-label={hunk.header}
                >
                  <h5>{hunk.header}</h5>
                  {stageable && supportsHunkActions(file) ? (
                    <div className="source-control__row-actions">
                      <button
                        type="button"
                        aria-label={`${staged ? "Unstage" : "Stage"} hunk ${hunk.header} in ${file.path}`}
                        disabled={busy}
                        onClick={() =>
                          onAction(
                            action(staged ? "unstage-hunk" : "stage-hunk", {
                              path: file.path,
                              hunk: index,
                            }),
                          )
                        }
                      >
                        {staged ? "Unstage hunk" : "Stage hunk"}
                      </button>
                    </div>
                  ) : null}
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
                        {line.noNewlineAtEndOfFile ? (
                          <span className="sr-only">
                            , no newline at end of file
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </>
          )}
        </article>
      ))}
      {onClose ? (
        <div className="source-control__actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Close diff
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The commits Denote has read, one bounded page at a time.
 *
 * The page is described rather than the log: there is no total, because
 * nothing counted one. Paging asks the provider for the next or previous
 * window, and the status line says which page is on screen.
 */
function HistoryPager({
  page,
  count,
  busy,
  onAction,
}: {
  page: PluginSourceControlHistoryPage;
  count: number;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  return (
    <div className="source-control__history-controls">
      <div className="source-control__row-actions">
        <button
          type="button"
          aria-label="Refresh history"
          disabled={busy || page.loading}
          onClick={() => onAction(action("refresh-history"))}
        >
          Refresh history
        </button>
        <button
          type="button"
          aria-label="Previous page of history"
          disabled={busy || page.loading || !page.hasPrevious}
          onClick={() => onAction(action("history-previous"))}
        >
          Previous
        </button>
        <button
          type="button"
          aria-label="Next page of history"
          disabled={busy || page.loading || !page.hasNext}
          onClick={() => onAction(action("history-next"))}
        >
          Next
        </button>
      </div>
      <p role="status" className="source-control__history-status">
        {page.loading
          ? "Reading history…"
          : `Page ${page.pageIndex + 1}, ${count} commit${count === 1 ? "" : "s"}${
              page.hasNext ? ", more available" : ""
            }`}
      </p>
      {page.error ? (
        <p className="source-control__limitation" role="status">
          {page.error}
        </p>
      ) : null}
    </div>
  );
}

/** One commit, with the author, date, parents, refs, and its exact diff. */
function CommitDetail({
  detail,
  busy,
  onAction,
  onOpenFile,
}: {
  detail: PluginSourceControlCommitDetail;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
  onOpenFile?: (path: string) => void;
}) {
  const { commit } = detail;
  return (
    <section
      className="source-control__detail"
      aria-labelledby="source-control-commit"
    >
      <h3 id="source-control-commit">{commit.summary}</h3>
      <dl>
        <div>
          <dt>Commit</dt>
          <dd>{commit.shortId}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{commit.authorName}</dd>
        </div>
        <div>
          <dt>Authored</dt>
          <dd>
            <time dateTime={commit.authoredAt}>{commit.authoredAt}</time>
          </dd>
        </div>
        <div>
          <dt>Parents</dt>
          <dd>{commit.parentIds.length > 0 ? commit.parentIds.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt>Refs</dt>
          <dd>{commit.refs.length > 0 ? commit.refs.join(", ") : "None"}</dd>
        </div>
      </dl>
      {detail.limitation ? (
        <p className="source-control__limitation" role="status">
          {detail.limitation}
        </p>
      ) : null}
      <DiffView
        files={detail.files}
        source={{ kind: "commit", commitId: commit.id }}
        busy={busy}
        headingId="source-control-commit-diff"
        label="Changed files"
        emptyMessage="This commit changed no files."
        onAction={onAction}
        onOpenFile={onOpenFile}
      />
      <div className="source-control__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => onAction(action("close-commit"))}
        >
          Back to history
        </button>
      </div>
    </section>
  );
}

/**
 * The checkout Denote prepared and did not run. Every path it would disturb is
 * named, and the only offers are to commit them, to stash them, or to cancel:
 * nothing here discards work.
 */
function PendingBranchSwitch({
  pending,
  busy,
  onAction,
}: {
  pending: PluginSourceControlPendingBranchSwitch;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [message, setMessage] = useState("");
  const destination = pending.localBranch ?? pending.target;
  const groups: Array<{ label: string; paths: string[] }> = [
    { label: "Staged", paths: pending.stagedPaths },
    { label: "Changed", paths: pending.unstagedPaths },
    { label: "Untracked", paths: pending.untrackedPaths },
  ];

  return (
    <section
      className="source-control__pending-switch"
      aria-labelledby="source-control-pending-switch"
    >
      <h3 id="source-control-pending-switch">Switch to {destination}</h3>
      <p role="status">
        Denote has not switched yet.{" "}
        {pending.fromBranch
          ? `Switching from ${pending.fromBranch} to ${destination}`
          : `Switching to ${destination}`}{" "}
        would disturb work in this vault, so choose what happens to it first.
        {pending.localBranch && pending.localBranch !== pending.target
          ? ` ${pending.localBranch} will be created from ${pending.target}.`
          : ""}
      </p>
      {groups.map((group) =>
        group.paths.length > 0 ? (
          <div key={group.label}>
            <h4>
              {group.label} <span>{group.paths.length}</span>
            </h4>
            <ul className="source-control__pending-paths">
              {group.paths.map((path) => (
                <li key={`${group.label}:${path}`}>{path}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = message.trim();
          if (!trimmed) {
            return;
          }
          onAction(
            action(pending.commitActionId, {
              message: trimmed,
              branch: destination,
              from: pending.fromBranch ?? "",
            }),
          );
        }}
      >
        <label className="source-control__field">
          <span>Commit message for the switch</span>
          <input
            value={message}
            disabled={busy || !pending.commitAvailable}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
        </label>
        <div className="source-control__actions">
          <button
            type="submit"
            className="primary-button"
            disabled={
              busy || !pending.commitAvailable || message.trim().length === 0
            }
          >
            Commit all and switch
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !pending.stashAvailable}
            onClick={() =>
              onAction(
                action(pending.stashActionId, {
                  branch: destination,
                  from: pending.fromBranch ?? "",
                }),
              )
            }
          >
            Stash and switch
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onAction(action(pending.cancelActionId))}
          >
            Cancel switch
          </button>
        </div>
      </form>
      {pending.stashUnavailableReason ? (
        <p className="source-control__limitation" role="status">
          {pending.stashUnavailableReason}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Branch creation, switching, renaming, deletion, and remote-tracking
 * checkout. Every control names the exact branch it acts on, and the host
 * confirms the ones that change or delete something.
 */
function BranchManagement({
  branches,
  busy,
  onAction,
}: {
  branches: PluginSourceControlBranchChoice[];
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [name, setName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [locals, setLocals] = useState<Record<string, string>>({});
  const current = branches.find((branch) => branch.current)?.name ?? "";

  return (
    <section aria-labelledby="source-control-branches">
      <h3 id="source-control-branches">Branches</h3>
      {branches.length > 0 ? (
        <ul className="source-control__branches">
          {branches.map((branch) => {
            const key = `${branch.remote ? "remote" : "local"}:${branch.name}`;
            const proposed =
              locals[branch.name] ?? localBranchNameFor(branch.name);
            const renamed = renames[branch.name] ?? branch.name;
            return (
              <li key={key}>
                <div className="source-control__resource-summary">
                  <strong>{branch.name}</strong>
                  <span>
                    {branch.remote ? "Remote" : "Local"}
                    {branch.current ? " · current" : ""} · {branch.ahead} ahead,{" "}
                    {branch.behind} behind
                  </span>
                </div>
                {branch.remote ? (
                  <>
                    <label className="source-control__field">
                      <span>Local branch name for {branch.name}</span>
                      <input
                        value={proposed}
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.currentTarget.value;
                          setLocals((previous) => ({
                            ...previous,
                            [branch.name]: next,
                          }));
                        }}
                      />
                    </label>
                    <div className="source-control__row-actions">
                      <button
                        type="button"
                        aria-label={`Check out ${branch.name} as a local branch`}
                        disabled={busy || proposed.trim().length === 0}
                        onClick={() =>
                          onAction(
                            action("checkout-remote-branch", {
                              remoteBranch: branch.name,
                              localName: proposed.trim(),
                              from: current,
                            }),
                          )
                        }
                      >
                        Check out
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="source-control__field">
                      <span>New name for {branch.name}</span>
                      <input
                        value={renamed}
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.currentTarget.value;
                          setRenames((previous) => ({
                            ...previous,
                            [branch.name]: next,
                          }));
                        }}
                      />
                    </label>
                    <div className="source-control__row-actions">
                      <button
                        type="button"
                        aria-label={`Switch to ${branch.name}`}
                        disabled={busy || branch.current}
                        onClick={() =>
                          onAction(
                            action("switch-branch", {
                              branch: branch.name,
                              from: current,
                            }),
                          )
                        }
                      >
                        Switch
                      </button>
                      <button
                        type="button"
                        aria-label={`Rename ${branch.name}`}
                        disabled={
                          busy ||
                          renamed.trim().length === 0 ||
                          renamed.trim() === branch.name
                        }
                        onClick={() =>
                          onAction(
                            action("rename-branch", {
                              name: branch.name,
                              newName: renamed.trim(),
                            }),
                          )
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${branch.name}`}
                        disabled={busy || branch.current}
                        onClick={() =>
                          onAction(
                            action("delete-branch", { name: branch.name }),
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sidebar-empty">No branches.</p>
      )}
      <form
        className="source-control__branch-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) {
            return;
          }
          onAction(
            action("create-branch", {
              name: trimmed,
              startPoint: startPoint.trim(),
              checkout,
              from: current,
            }),
          );
          setName("");
        }}
      >
        <label className="source-control__field">
          <span>New branch name</span>
          <input
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label className="source-control__field">
          <span>Start point</span>
          <select
            value={startPoint}
            disabled={busy}
            onChange={(event) => setStartPoint(event.currentTarget.value)}
          >
            <option value="">
              {current ? `Current branch (${current})` : "Current branch"}
            </option>
            {branches.map((branch) => (
              <option
                value={branch.name}
                key={`start:${branch.remote ? "remote" : "local"}:${branch.name}`}
              >
                {branch.name}
                {branch.remote ? " (remote)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="source-control__checkbox">
          <input
            type="checkbox"
            checked={checkout}
            disabled={busy}
            onChange={(event) => setCheckout(event.currentTarget.checked)}
          />
          <span>Check out the new branch straight away</span>
        </label>
        <div className="source-control__actions">
          <button
            type="submit"
            className="secondary-button"
            disabled={busy || name.trim().length === 0}
          >
            Create branch
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Proposes the local name for a remote-tracking branch by dropping the remote
 * it lives under.
 */
function localBranchNameFor(remoteBranch: string): string {
  const separator = remoteBranch.indexOf("/");
  return separator === -1 ? remoteBranch : remoteBranch.slice(separator + 1);
}

function CloneOnboarding({
  remoteAccess,
  busy,
  onAction,
}: {
  remoteAccess: PluginSourceControlRemoteAccess;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");

  if (!remoteAccess.cloneAvailable) {
    return null;
  }

  return (
    <section
      className="source-control__clone"
      aria-labelledby="source-control-clone"
    >
      <h3 id="source-control-clone">Clone a repository</h3>
      <p className="source-control__hint">
        Denote asks you to choose an empty folder, clones into it, and opens it
        as a vault.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = url.trim();
          if (!trimmed) {
            return;
          }
          const values: Record<string, string> = { url: trimmed };
          if (branch.trim()) {
            values.branch = branch.trim();
          }
          onAction(action("clone", values));
        }}
      >
        <label className="source-control__field">
          <span>Repository URL</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://host.example/owner/repository.git"
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        <label className="source-control__field">
          <span>Branch (optional)</span>
          <input
            value={branch}
            disabled={busy}
            onChange={(event) => setBranch(event.currentTarget.value)}
          />
        </label>
        <dl className="source-control__configured">
          <div>
            <dt>Authentication</dt>
            <dd>{authModeLabels[remoteAccess.authMode]}</dd>
          </div>
        </dl>
        <p className="source-control__hint">
          Every fetch, pull, push, and clone uses this mode. Change it in
          Settings, under this plugin's settings.
        </p>
        <div className="source-control__actions">
          <button
            type="submit"
            className="primary-button"
            disabled={busy || url.trim().length === 0}
          >
            Choose folder and clone
          </button>
          {remoteAccess.githubAvailable ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onAction(action("browse-github"))}
            >
              Browse GitHub repositories
            </button>
          ) : null}
        </div>
      </form>
      {remoteAccess.repositories.length > 0 ? (
        <ul className="source-control__repositories">
          {remoteAccess.repositories.map((repository) => (
            <li key={repository.nameWithOwner}>
              <button
                type="button"
                aria-label={`Use ${repository.nameWithOwner}`}
                disabled={busy}
                onClick={() => {
                  setUrl(repository.httpsUrl);
                  setBranch(repository.defaultBranch ?? "");
                  onAction(
                    action("select-repository", {
                      nameWithOwner: repository.nameWithOwner,
                      url: repository.httpsUrl,
                    }),
                  );
                }}
              >
                <strong>{repository.nameWithOwner}</strong>
                <span>
                  {repository.private ? "Private" : "Public"}
                  {repository.defaultBranch
                    ? ` · ${repository.defaultBranch}`
                    : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {remoteAccess.cleanup ? (
        <div className="source-control__cleanup">
          <p role="status">
            A clone did not finish and left {remoteAccess.cleanup.label} behind.
            Denote never deletes it for you.
          </p>
          <div className="source-control__actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                onAction(
                  action("clean-failed-clone", {
                    token: remoteAccess.cleanup?.token ?? "",
                  }),
                )
              }
            >
              Clean incomplete clone
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RemoteManagement({
  remotes,
  busy,
  onAction,
}: {
  remotes: PluginSourceControlRemote[];
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  return (
    <section aria-labelledby="source-control-remotes">
      <h3 id="source-control-remotes">Remotes</h3>
      {remotes.length > 0 ? (
        <ul className="source-control__remotes">
          {remotes.map((remote) => {
            const current = remote.fetchUrl ?? "";
            const edited = edits[remote.name] ?? current;
            return (
              <li key={remote.name}>
                <strong>{remote.name}</strong>
                <span>Fetch: {remote.fetchUrl ?? "Unavailable"}</span>
                <span>Push: {remote.pushUrl ?? "Unavailable"}</span>
                <label className="source-control__field">
                  <span>URL for {remote.name}</span>
                  <input
                    type="url"
                    inputMode="url"
                    value={edited}
                    disabled={busy}
                    onChange={(event) => {
                      // The value is read before the updater runs: React
                      // clears the event by the time a functional update is
                      // applied.
                      const next = event.currentTarget.value;
                      setEdits((previous) => ({
                        ...previous,
                        [remote.name]: next,
                      }));
                    }}
                  />
                </label>
                <div className="source-control__row-actions">
                  <button
                    type="button"
                    aria-label={`Save the URL for ${remote.name}`}
                    disabled={
                      busy ||
                      edited.trim().length === 0 ||
                      edited.trim() === current
                    }
                    onClick={() =>
                      onAction(
                        action("set-remote-url", {
                          name: remote.name,
                          url: edited.trim(),
                        }),
                      )
                    }
                  >
                    Save URL
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove the ${remote.name} remote`}
                    disabled={busy}
                    onClick={() =>
                      onAction(action("remove-remote", { name: remote.name }))
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sidebar-empty">No remotes.</p>
      )}
      <form
        className="source-control__remote-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !url.trim()) {
            return;
          }
          onAction(
            action("add-remote", { name: name.trim(), url: url.trim() }),
          );
          setName("");
          setUrl("");
        }}
      >
        <label className="source-control__field">
          <span>New remote name</span>
          <input
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label className="source-control__field">
          <span>New remote URL</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://host.example/owner/repository.git"
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        <div className="source-control__actions">
          <button
            type="submit"
            className="secondary-button"
            disabled={busy || !name.trim() || !url.trim()}
          >
            Add remote
          </button>
        </div>
      </form>
    </section>
  );
}

function OperationReview({
  remoteAccess,
  busy,
  onAction,
}: {
  remoteAccess: PluginSourceControlRemoteAccess;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const review = remoteAccess.review;
  if (!review) {
    return null;
  }

  return (
    <section
      className="source-control__review"
      aria-labelledby="source-control-review"
    >
      <h3 id="source-control-review">Last remote operation</h3>
      <p role="status">
        {review.operation}: {review.summary}
      </p>
      {review.detail ? <p>{review.detail}</p> : null}
      <div className="source-control__actions">
        {review.retryActionId ? (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onAction(action(review.retryActionId as string))}
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => onAction(action("dismiss-review"))}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

export function SourceControlPanel({
  title,
  model,
  onAction,
  onOpenFile,
}: SourceControlPanelProps) {
  const { repository, remoteAccess } = model;
  const [commitMessage, setCommitMessage] = useState("");
  const [chosenRemote, setChosenRemote] = useState("");
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
    setChosenRemote("");
  }, [repository.repositoryId]);

  const openedDiffPath =
    model.selectedView.kind === "diff" ? model.selectedView.path : null;
  // A path that is both staged and changed has two diffs to look at, so the
  // side on screen is named and the other one is offered.
  const diffSides =
    openedDiffPath === null
      ? []
      : (["unstaged", "staged"] as const).filter((kind) =>
          model.resourceGroups.some(
            (group) =>
              group.kind === kind &&
              group.resources.some(
                (resource) => resource.path === openedDiffPath,
              ),
          ),
        );
  const openDiff = (path: string, group: string) => {
    onAction(action("open-diff", { path, group }));
  };

  const remoteNames = model.remotes.map((remote) => remote.name);
  // A repository normally has exactly one remote, so the first one is the
  // obvious default and the control only has to be touched when there is a
  // real choice to make.
  const activeRemote =
    chosenRemote && remoteNames.includes(chosenRemote)
      ? chosenRemote
      : (remoteNames[0] ?? "");
  const remoteBranch = selectedBranch || repository.branch || "";
  const canReachRemote = activeRemote.length > 0 && !repository.busy;

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
                  action("switch-branch", {
                    branch: event.currentTarget.value,
                    from: selectedBranch,
                  }),
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
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canReachRemote}
                  onClick={() =>
                    onAction(action("fetch", { remote: activeRemote }))
                  }
                >
                  Fetch
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canReachRemote || remoteBranch.length === 0}
                  onClick={() =>
                    onAction(
                      action("pull", {
                        remote: activeRemote,
                        branch: remoteBranch,
                      }),
                    )
                  }
                >
                  Pull
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canReachRemote || remoteBranch.length === 0}
                  onClick={() =>
                    onAction(
                      action("push", {
                        remote: activeRemote,
                        branch: remoteBranch,
                      }),
                    )
                  }
                >
                  Push
                </button>
              </>
            )}
          </div>
          {repository.initialized && model.remotes.length > 1 ? (
            <label className="source-control__field">
              <span>Remote</span>
              <select
                value={activeRemote}
                disabled={repository.busy}
                onChange={(event) => setChosenRemote(event.currentTarget.value)}
              >
                {remoteNames.map((name) => (
                  <option value={name} key={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {repository.initialized && model.remotes.length === 0 ? (
            <p className="source-control__hint">
              This repository has no remote yet. Add one on the Branches tab to
              fetch, pull, or push.
            </p>
          ) : null}
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
                        onOpenDiff={openDiff}
                        onOpenFile={onOpenFile}
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
                  {model.selectedView.kind === "diff" && openedDiffPath ? (
                    <>
                      {diffSides.length > 1 ? (
                        <div
                          className="source-control__row-actions"
                          role="group"
                          aria-label={`Diff side for ${openedDiffPath}`}
                        >
                          {diffSides.map((side) => (
                            <button
                              type="button"
                              key={side}
                              aria-pressed={
                                side === "staged"
                                  ? model.diffSource?.kind === "index"
                                  : model.diffSource?.kind === "worktree"
                              }
                              disabled={repository.busy}
                              onClick={() => openDiff(openedDiffPath, side)}
                            >
                              {side === "staged" ? "Staged" : "Working tree"}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <DiffView
                        files={model.diffFiles}
                        source={model.diffSource}
                        busy={repository.busy}
                        headingId="source-control-diff"
                        label={
                          model.diffSource?.kind === "index"
                            ? `Staged diff: ${openedDiffPath}`
                            : `Working tree diff: ${openedDiffPath}`
                        }
                        onAction={onAction}
                        onOpenFile={onOpenFile}
                        onClose={() => onAction(action("close-diff"))}
                      />
                    </>
                  ) : null}
                </>
              ) : model.selectedTab === "history" ? (
                <>
                  <HistoryPager
                    page={model.historyPage}
                    count={model.history.length}
                    busy={repository.busy}
                    onAction={onAction}
                  />
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
                              disabled={repository.busy}
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
                  {model.commitDetail ? (
                    <CommitDetail
                      detail={model.commitDetail}
                      busy={repository.busy}
                      onAction={onAction}
                      onOpenFile={onOpenFile}
                    />
                  ) : null}
                </>
              ) : (
                <div className="source-control__branch-lists">
                  <BranchManagement
                    branches={model.branches}
                    busy={repository.busy}
                    onAction={onAction}
                  />
                  <RemoteManagement
                    remotes={model.remotes}
                    busy={repository.busy}
                    onAction={onAction}
                  />
                </div>
              )}
            </div>
          </>
        ) : null}

        {model.pendingBranchSwitch ? (
          <PendingBranchSwitch
            pending={model.pendingBranchSwitch}
            busy={repository.busy}
            onAction={onAction}
          />
        ) : null}

        <CloneOnboarding
          remoteAccess={remoteAccess}
          busy={repository.busy}
          onAction={onAction}
        />

        <OperationReview
          remoteAccess={remoteAccess}
          busy={repository.busy}
          onAction={onAction}
        />

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
