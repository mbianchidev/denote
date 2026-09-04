import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  FileDiff,
  FileText,
  ListMinus,
  ListPlus,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import { SourceControlBranchPicker } from "./SourceControlBranchPicker";
import type {
  PluginSourceControlAction,
  PluginSourceControlAdvancedOperation,
  PluginSourceControlAuthMode,
  PluginSourceControlBranchChoice,
  PluginSourceControlCommitDetail,
  PluginSourceControlConflictDetail,
  PluginSourceControlConflictSide,
  PluginSourceControlConflictSideKind,
  PluginSourceControlDiffFile,
  PluginSourceControlDiffSource,
  PluginSourceControlHistoryPage,
  PluginSourceControlOperationPlan,
  PluginSourceControlOperationProgress,
  PluginSourceControlPendingBranchSwitch,
  PluginSourceControlRemote,
  PluginSourceControlRemoteAccess,
  PluginSourceControlResourceGroup,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";

interface SourceControlPanelProps {
  title: string;
  model: PluginSourceControlViewModel;
  onAction: (
    action: PluginSourceControlAction,
    hostOptions?: SourceControlActionHostOptions,
  ) => void;
  /**
   * Opens one repository-relative path in the editor.
   *
   * The host owns this entirely: it resolves the path inside the open vault
   * and uses the ordinary file-open flow, so no provider ever names a place on
   * disk and no Git command is involved in opening a note.
   */
  onOpenFile?: (path: string) => void;
}

export interface SourceControlActionHostOptions {
  gitSigningPassphrase?: string;
}

const tabs = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Remotes" },
] as const;

type SourceControlTab = (typeof tabs)[number]["id"];

const authModeLabels: Record<PluginSourceControlAuthMode, string> = {
  system: "System Git credentials",
  public: "Public repository",
  "ssh-agent": "SSH agent",
  "github-https": "GitHub sign-in",
};

const operationLabels: Record<PluginSourceControlAdvancedOperation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
};

const riskLabels: Record<
  PluginSourceControlOperationPlan["risk"],
  string
> = {
  "creates-commit": "Records a new commit; nothing already recorded changes",
  "may-conflict": "May stop with conflicts for you to resolve",
  "rewrites-history": "Rewrites commits: they are recorded again with new identities",
};

/** The verb each prepared operation is described with in its review. */
const pendingOperationVerbs: Record<string, string> = {
  checkout: "switch",
  merge: "merge",
  rebase: "rebase",
  "cherry-pick": "cherry-pick",
  revert: "revert",
};

const conflictSideOrder: PluginSourceControlConflictSideKind[] = [
  "base",
  "ours",
  "theirs",
];

/**
 * The value one advanced operation carries.
 *
 * A merge and a rebase name a branch, and a cherry-pick and a revert name the
 * commit that was selected, so the action a surface returns always matches the
 * operation the provider prepared.
 */
/**
 * The typed values one advanced operation is started with.
 *
 * The branch the review was prepared on travels with it, so the host
 * confirmation names both the branch that changes and the source it acts on
 * rather than falling back to "the current branch".
 */
function operationValues(
  operation: PluginSourceControlAdvancedOperation,
  source: string,
  currentBranch: string | null,
): PluginSourceControlAction["values"] {
  const values: Record<string, string> =
    operation === "merge" || operation === "rebase"
      ? { ref: source, operation }
      : { commitId: source, operation };
  return currentBranch ? { ...values, from: currentBranch } : values;
}

function action(
  id: string,
  values?: PluginSourceControlAction["values"],
): PluginSourceControlAction {
  return values ? { id, values } : { id };
}

function WorkspaceRepositories({
  repositories,
  busy,
  onAction,
}: {
  repositories: NonNullable<
    PluginSourceControlViewModel["workspaceRepositories"]
  >;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  if (repositories.length === 0) {
    return null;
  }
  return (
    <section
      className="source-control__workspace-repositories"
      aria-labelledby="source-control-workspace-repositories"
    >
      <h3 id="source-control-workspace-repositories">Repositories</h3>
      <ul>
        {repositories.map((repository) => (
          <li key={repository.repositoryId}>
            <button
              type="button"
              aria-label={`Select ${repository.label} repository`}
              aria-pressed={repository.selected}
              disabled={busy || repository.selected}
              onClick={() =>
                onAction(
                  action("select-workspace-repository", {
                    repositoryId: repository.repositoryId,
                  }),
                )
              }
            >
              <strong>{repository.label}</strong>
              <span>
                {repository.initialized
                  ? `${repository.branch ?? "Detached"} · ${repository.changes} change${repository.changes === 1 ? "" : "s"}`
                  : "Not initialized"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResourceGroup({
  group,
  busy,
  onAction,
  onOpenDiff,
  onOpenFile,
  upstream,
}: {
  group: PluginSourceControlResourceGroup;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
  onOpenDiff: (path: string, group: string) => void;
  onOpenFile?: (path: string) => void;
  upstream: string | null;
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
                  title={`Unstage ${resource.path}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(action("unstage", { path: resource.path }))
                  }
                >
                  <Minus aria-hidden="true" size={14} />
                </button>
              ) : group.kind === "unstaged" || group.kind === "untracked" ? (
                <button
                  type="button"
                  aria-label={`Stage ${resource.path}`}
                  title={`Stage ${resource.path}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(action("stage", { path: resource.path }))
                  }
                >
                  <Plus aria-hidden="true" size={14} />
                </button>
              ) : null}
              {(group.kind === "staged" || group.kind === "unstaged") &&
              upstream ? (
                <button
                  type="button"
                  aria-label={`Restore ${resource.path} from ${upstream}`}
                  title={`Restore ${resource.path} from ${upstream}`}
                  disabled={busy}
                  onClick={() =>
                    onAction(
                      action("restore-from-upstream", {
                        path: resource.path,
                      }),
                    )
                  }
                >
                  <Undo2 aria-hidden="true" size={14} />
                </button>
              ) : null}
              {group.kind === "staged" || group.kind === "unstaged" ? (
                <button
                  type="button"
                  aria-label={`Open diff for ${resource.path}`}
                  title={`Open diff for ${resource.path}`}
                  disabled={busy}
                  onClick={() => onOpenDiff(resource.path, group.kind)}
                >
                  <FileDiff aria-hidden="true" size={14} />
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
                  title={`Open file ${resource.path}`}
                  onClick={() => onOpenFile(resource.path)}
                >
                  <FileText aria-hidden="true" size={14} />
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
  summaryOnly = false,
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
  summaryOnly?: boolean;
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
              {summaryOnly
                ? null
                : file.hunks.map((hunk, index) => (
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
                        title={`${staged ? "Unstage" : "Stage"} hunk ${hunk.header} in ${file.path}`}
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
                        {staged ? (
                          <Minus aria-hidden="true" size={14} />
                        ) : (
                          <Plus aria-hidden="true" size={14} />
                        )}
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
            className="secondary-button source-control__compact-action"
            aria-label="Close diff"
            title="Close diff"
            disabled={busy}
            onClick={onClose}
          >
            <X aria-hidden="true" size={14} />
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
          title="Refresh history"
          disabled={busy || page.loading}
          onClick={() => onAction(action("refresh-history"))}
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          aria-label="Previous page of history"
          title="Previous page of history"
          disabled={busy || page.loading || !page.hasPrevious}
          onClick={() => onAction(action("history-previous"))}
        >
          <ArrowLeft aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          aria-label="Next page of history"
          title="Next page of history"
          disabled={busy || page.loading || !page.hasNext}
          onClick={() => onAction(action("history-next"))}
        >
          <ArrowRight aria-hidden="true" size={14} />
        </button>
      </div>
      <p role="status" className="source-control__history-status">
        {page.loading
          ? "Reading history…"
          : `Page ${page.pageIndex + 1} · ${count} commit${count === 1 ? "" : "s"}${
              page.hasNext ? " · More available" : ""
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
        summaryOnly
        onAction={onAction}
        onOpenFile={onOpenFile}
      />
      <p className="source-control__status" role="status">
        The commit patch is open as a temporary .diff tab in the editor.
      </p>
      <div className="source-control__actions">
        <button
          type="button"
          className="secondary-button"
          aria-label={`Review cherry-picking ${commit.shortId}`}
          disabled={busy}
          onClick={() =>
            onAction(action("prepare-cherry-pick", { commitId: commit.id }))
          }
        >
          Review cherry-pick
        </button>
        <button
          type="button"
          className="secondary-button"
          aria-label={`Review reverting ${commit.shortId}`}
          disabled={busy}
          onClick={() =>
            onAction(action("prepare-revert", { commitId: commit.id }))
          }
        >
          Review revert
        </button>
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
  const [sign, setSign] = useState(true);
  const [signingPassphrase, setSigningPassphrase] = useState("");
  const destination = pending.localBranch ?? pending.target;
  const checkout = pending.operation === "checkout";
  // Every label comes from the typed operation the provider named, so the
  // review describes what will actually run rather than assuming a checkout.
  const verb = pendingOperationVerbs[pending.operation];
  const leaving = pending.fromBranch ?? "the current branch";
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
      <h3 id="source-control-pending-switch">
        {pending.operation === "checkout"
          ? `Switch to ${destination}`
          : `${operationLabels[pending.operation]} ${pending.target}`}
      </h3>
      <p role="status">
        {checkout ? (
          <>
            Denote has not switched yet.{" "}
            {pending.fromBranch
              ? `Switching from ${pending.fromBranch} to ${destination}`
              : `Switching to ${destination}`}{" "}
            would disturb work in this vault, so choose what happens to it
            first.
            {pending.localBranch && pending.localBranch !== pending.target
              ? ` ${pending.localBranch} will be created from ${pending.target}.`
              : ""}
          </>
        ) : (
          <>
            {`Denote has not started the ${pending.operation} yet. Running it on ${leaving} would disturb work in this vault, so choose what happens to that work first.`}
            {pending.operation === "rebase"
              ? ` The rebase then rewrites the commits on ${leaving}.`
              : ""}
          </>
        )}
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
          const commitAction = action(pending.commitActionId, {
            message: trimmed,
            sign,
            branch: destination,
            from: pending.fromBranch ?? "",
            operation: pending.operation,
          });
          onAction(
            commitAction,
            sign && signingPassphrase
              ? { gitSigningPassphrase: signingPassphrase }
              : undefined,
          );
          setSigningPassphrase("");
        }}
      >
        <label className="source-control__field">
          <span>{`Commit message for the ${verb}`}</span>
          <input
            value={message}
            disabled={busy || !pending.commitAvailable}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
        </label>
        <label className="source-control__checkbox">
          <input
            type="checkbox"
            checked={sign}
            disabled={busy || !pending.commitAvailable}
            onChange={(event) => {
              setSign(event.currentTarget.checked);
              if (!event.currentTarget.checked) {
                setSigningPassphrase("");
              }
            }}
          />
          <span>Sign this commit</span>
        </label>
        {sign ? (
          <label className="source-control__field">
            <span>Signing passphrase (SSH keys only, optional)</span>
            <input
              type="password"
              value={signingPassphrase}
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              disabled={busy || !pending.commitAvailable}
              onChange={(event) =>
                setSigningPassphrase(event.currentTarget.value)
              }
            />
          </label>
        ) : null}
        <div className="source-control__actions">
          <button
            type="submit"
            className="primary-button"
            disabled={
              busy || !pending.commitAvailable || message.trim().length === 0
            }
          >
            {`Commit all and ${verb}`}
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
                  operation: pending.operation,
                }),
              )
            }
          >
            {`Stash and ${verb}`}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onAction(action(pending.cancelActionId))}
          >
            {`Cancel ${verb}`}
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

export function CloneOnboarding({
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

const ADD_REMOTE_VALUE = "__add-remote__";

function RemoteManagement({
  remotes,
  busy,
  onAction,
}: {
  remotes: PluginSourceControlRemote[];
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [selected, setSelected] = useState(
    remotes[0]?.name ?? ADD_REMOTE_VALUE,
  );
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const active =
    remotes.find((remote) => remote.name === selected) ??
    (selected === ADD_REMOTE_VALUE ? null : remotes[0] ?? null);
  const selection = active?.name ?? ADD_REMOTE_VALUE;
  const currentUrl = active?.fetchUrl ?? "";
  const editedUrl = active ? (edits[active.name] ?? currentUrl) : url;

  return (
    <section aria-labelledby="source-control-remotes">
      <h3 id="source-control-remotes">Remotes</h3>
      <form
        className="source-control__remote-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (active) {
            const next = editedUrl.trim();
            if (!next || next === currentUrl) {
              return;
            }
            onAction(
              action("set-remote-url", { name: active.name, url: next }),
            );
            return;
          }
          const remoteName = name.trim();
          const remoteUrl = url.trim();
          if (!remoteName || !remoteUrl) {
            return;
          }
          onAction(
            action("add-remote", { name: remoteName, url: remoteUrl }),
          );
          setName("");
          setUrl("");
        }}
      >
        <label className="source-control__field">
          <span>Remote</span>
          <select
            value={selection}
            disabled={busy}
            onChange={(event) => setSelected(event.currentTarget.value)}
          >
            {remotes.map((remote) => (
              <option value={remote.name} key={remote.name}>
                {remote.name}
              </option>
            ))}
            <option value={ADD_REMOTE_VALUE}>Add remote…</option>
          </select>
        </label>
        {active ? (
          <dl className="source-control__remote-summary">
            <div>
              <dt>Fetch</dt>
              <dd>{active.fetchUrl ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Push</dt>
              <dd>{active.pushUrl ?? "Unavailable"}</dd>
            </div>
          </dl>
        ) : (
          <label className="source-control__field">
            <span>Remote name</span>
            <input
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
        )}
        <label className="source-control__field">
          <span>{active ? `URL for ${active.name}` : "Remote URL"}</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://host.example/owner/repository.git"
            value={editedUrl}
            disabled={busy}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (active) {
                setEdits((previous) => ({
                  ...previous,
                  [active.name]: next,
                }));
              } else {
                setUrl(next);
              }
            }}
          />
        </label>
        <div className="source-control__actions">
          <button
            type="submit"
            className="secondary-button"
            aria-label={active ? `Save the URL for ${active.name}` : undefined}
            disabled={
              busy ||
              (active
                ? !editedUrl.trim() || editedUrl.trim() === currentUrl
                : !name.trim() || !url.trim())
            }
          >
            {active ? "Save URL" : "Add remote"}
          </button>
          {active ? (
            <button
              type="button"
              className="secondary-button"
              aria-label={`Remove the ${active.name} remote`}
              disabled={busy}
              onClick={() =>
                onAction(action("remove-remote", { name: active.name }))
              }
            >
              Remove
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/**
 * One advanced operation that has been prepared and not run.
 *
 * Everything the provider read is named: the source, the branch it would
 * change, what it risks, and the files it is expected to touch. Starting it is
 * a separate, explicit action the host confirms.
 */
/**
 * Merge and rebase, which both act on a branch this repository already has.
 *
 * Nothing starts here: the button prepares a review, and the review is what
 * offers to run the operation. A repository that is already part way through
 * an operation offers neither, because finishing that one comes first.
 */
function AdvancedOperations({
  branches,
  busy,
  blocked,
  onAction,
}: {
  branches: PluginSourceControlBranchChoice[];
  busy: boolean;
  blocked: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [chosen, setChosen] = useState("");
  const options = branches.filter((branch) => !branch.current);
  const source = chosen || (options[0]?.name ?? "");

  return (
    <details className="source-control__advanced">
      <summary>Merge and rebase</summary>
      <div className="source-control__advanced-body">
        {options.length > 0 ? (
          <>
            <label className="source-control__field">
              <span>Branch to use</span>
              <select
                value={source}
                disabled={busy || blocked}
                onChange={(event) => setChosen(event.currentTarget.value)}
              >
                {options.map((branch) => (
                  <option
                    value={branch.name}
                    key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
                  >
                    {branch.name}
                    {branch.remote ? " (remote)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="source-control__actions">
              <button
                type="button"
                className="secondary-button"
                aria-label={`Review merging ${source}`}
                disabled={busy || blocked || source.length === 0}
                onClick={() =>
                  onAction(action("prepare-merge", { ref: source }))
                }
              >
                Review merge
              </button>
              <button
                type="button"
                className="secondary-button"
                aria-label={`Review rebasing onto ${source}`}
                disabled={busy || blocked || source.length === 0}
                onClick={() =>
                  onAction(action("prepare-rebase", { ref: source }))
                }
              >
                Review rebase
              </button>
            </div>
            <p className="source-control__hint">
              Denote reviews a merge or a rebase before it runs, and never
              force-pushes or resets anything.
            </p>
          </>
        ) : (
          <p className="sidebar-empty">
            This repository has no other branch to merge or rebase onto.
          </p>
        )}
        {blocked ? (
          <p className="source-control__limitation" role="status">
            Finish the operation that is already in progress before starting
            another one.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function OperationPlan({
  plan,
  busy,
  onAction,
}: {
  plan: PluginSourceControlOperationPlan;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const label = operationLabels[plan.operation];
  return (
    <section
      className="source-control__operation-plan"
      aria-labelledby="source-control-operation-plan"
    >
      <h3 id="source-control-operation-plan">Review this {plan.operation}</h3>
      <dl>
        <div>
          <dt>Operation</dt>
          <dd>{label}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {plan.source}
            {plan.sourceDetail ? ` · ${plan.sourceDetail}` : ""}
          </dd>
        </div>
        <div>
          <dt>Current branch</dt>
          <dd>{plan.currentBranch ?? "None"}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{riskLabels[plan.risk]}</dd>
        </div>
      </dl>
      <p role="status">{plan.summary}</p>
      <h4>Files this may change</h4>
      {plan.affectedPaths.length > 0 ? (
        <ul className="source-control__pending-paths">
          {plan.affectedPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : (
        <p className="sidebar-empty">Denote listed no files for this one.</p>
      )}
      {plan.affectedPathsLimitation ? (
        <p className="source-control__limitation" role="status">
          {plan.affectedPathsLimitation}
        </p>
      ) : null}
      <div className="source-control__actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() =>
            onAction(
              action(
                plan.startActionId,
                operationValues(plan.operation, plan.source, plan.currentBranch),
              ),
            )
          }
        >
          Start {plan.operation}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => onAction(action(plan.cancelActionId))}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * The operation Git is part way through, and only the controls that are valid
 * for it.
 *
 * Continue stays disabled, with the reason on screen, until Git reports no
 * unmerged paths. A merge offers no skip, because Git has none. Every control
 * names the operation it acts on, so nothing here can resume something else.
 */
function OperationProgress({
  progress,
  busy,
  onAction,
}: {
  progress: PluginSourceControlOperationProgress;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const values = { sequencer: progress.operation };
  return (
    <section
      className="source-control__operation"
      aria-labelledby="source-control-operation"
    >
      <h3 id="source-control-operation">
        {operationLabels[progress.operation]} in progress
      </h3>
      <p role="status">{progress.summary}</p>
      {progress.conflictedPaths.length > 0 ? (
        <ul className="source-control__pending-paths">
          {progress.conflictedPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : null}
      <div className="source-control__actions">
        <button
          type="button"
          className="primary-button"
          aria-label={`Continue the ${progress.operation}`}
          disabled={busy || !progress.continueAvailable}
          onClick={() => onAction(action("continue", values))}
        >
          Continue
        </button>
        {progress.skipAvailable ? (
          <button
            type="button"
            className="secondary-button"
            aria-label={`Skip this step of the ${progress.operation}`}
            disabled={busy}
            onClick={() => onAction(action("skip", values))}
          >
            Skip
          </button>
        ) : null}
        {progress.abortAvailable ? (
          <button
            type="button"
            className="secondary-button"
            aria-label={`Abort the ${progress.operation}`}
            disabled={busy}
            onClick={() => onAction(action("abort", values))}
          >
            Abort
          </button>
        ) : null}
      </div>
      {progress.continueUnavailableReason ? (
        <p className="source-control__limitation" role="status">
          {progress.continueUnavailableReason}
        </p>
      ) : null}
    </section>
  );
}

/** One recorded side of a conflict, rendered as its own labelled pane. */
function ConflictPane({
  side,
  path,
}: {
  side: PluginSourceControlConflictSide;
  path: string;
}) {
  const id = `source-control-conflict-${side.side}`;
  return (
    <section className="source-control__conflict-pane" aria-labelledby={id}>
      <h5 id={id}>{side.label}</h5>
      {side.present ? (
        side.text === null ? (
          <p className="source-control__limitation" role="status">
            Denote does not display this side&apos;s content.
          </p>
        ) : (
          <pre aria-label={`${side.label} of ${path}`}>{side.text}</pre>
        )
      ) : (
        <p className="source-control__limitation" role="status">
          Git does not hold this side of {path}.
        </p>
      )}
    </section>
  );
}

/**
 * The three-way conflict editor.
 *
 * Every side comes from the index, so what is on screen is what Git recorded
 * rather than anything read back out of the working tree. A change both sides
 * made differently is offered as a choice between the three recorded sides; a
 * change only one side made is already in the result and is shown as such.
 * Binary and encrypted conflicts never reach the line-level controls at all.
 */
function ConflictEditor({
  detail,
  busy,
  onAction,
}: {
  detail: PluginSourceControlConflictDetail;
  busy: boolean;
  onAction: SourceControlPanelProps["onAction"];
}) {
  const [draft, setDraft] = useState(detail.result ?? "");
  const sent = useRef<string | null>(detail.result);
  const path = detail.path;
  const sides: Record<
    PluginSourceControlConflictSideKind,
    PluginSourceControlConflictSide
  > = { base: detail.base, ours: detail.ours, theirs: detail.theirs };

  useEffect(() => {
    // A result the provider changed — a chosen change, a whole side, or a
    // discarded edit — replaces the draft. The user's own typing does not,
    // because it is what produced the value coming back.
    if (detail.result !== null && detail.result !== sent.current) {
      setDraft(detail.result);
      sent.current = detail.result;
    }
  }, [detail.path, detail.result]);

  const available = conflictSideOrder.filter((side) => sides[side].present);
  const resolvable = detail.unresolvedChunks === 0;

  return (
    <section
      className="source-control__conflict"
      aria-labelledby="source-control-conflict"
    >
      <h3 id="source-control-conflict">Conflict: {path}</h3>
      {detail.operation ? (
        <p>
          Recorded by the {detail.operation} this repository is part way
          through.
        </p>
      ) : null}
      <dl>
        {conflictSideOrder.map((side) => (
          <div key={side}>
            <dt>{sideHeading(side)}</dt>
            <dd>
              {sides[side].label}
              {sides[side].present ? "" : " · not recorded"}
            </dd>
          </div>
        ))}
      </dl>
      {detail.loading ? (
        <p className="source-control__status" role="status">
          Reading the recorded sides of {path}…
        </p>
      ) : null}
      {detail.limitation ? (
        <p className="source-control__limitation" role="status">
          {detail.limitation}
        </p>
      ) : null}
      {detail.status ? (
        <p className="source-control__status" role="status">
          {detail.status}
        </p>
      ) : null}
      {detail.error ? (
        <p className="source-control__limitation" role="status">
          {detail.error}
        </p>
      ) : null}
      {detail.wholeSideOnly ? (
        <div
          className="source-control__actions"
          role="group"
          aria-label={`Resolve ${path} with one whole side`}
        >
          {available.map((side) => (
            <button
              type="button"
              key={side}
              className="secondary-button"
              aria-label={`Resolve ${path} with ${sides[side].label}`}
              disabled={busy}
              onClick={() =>
                onAction(action("resolve-conflict-stage", { side }))
              }
            >
              Use {sideHeading(side).toLowerCase()}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="source-control__conflict-panes">
            {conflictSideOrder.map((side) => (
              <ConflictPane key={side} side={sides[side]} path={path} />
            ))}
          </div>
          <div
            className="source-control__row-actions"
            role="group"
            aria-label={`Use one whole side of ${path}`}
          >
            {available.map((side) => (
              <button
                type="button"
                key={side}
                aria-label={`Use ${sides[side].label} for the whole file`}
                disabled={busy}
                onClick={() => onAction(action("use-conflict-side", { side }))}
              >
                Use {sideHeading(side).toLowerCase()}
              </button>
            ))}
          </div>
          <h4>Changes</h4>
          {detail.chunks.some((chunk) => chunk.kind === "conflict") ? (
            <ol className="source-control__conflict-chunks">
              {detail.chunks
                .filter((chunk) => chunk.kind === "conflict")
                .map((chunk, index) => (
                  <li key={chunk.id}>
                    <div
                      className="source-control__row-actions"
                      role="group"
                      aria-label={`Change ${index + 1} of ${path}`}
                    >
                      {conflictSideOrder.map((side) => (
                        <button
                          type="button"
                          key={side}
                          aria-pressed={chunk.choice === side}
                          aria-label={`Use ${sides[side].label} for change ${index + 1}`}
                          disabled={busy || !sides[side].present}
                          onClick={() =>
                            onAction(
                              action("choose-conflict-change", {
                                chunkId: chunk.id,
                                side,
                              }),
                            )
                          }
                        >
                          {sideHeading(side)}
                        </button>
                      ))}
                    </div>
                    <div className="source-control__conflict-lines">
                      {conflictSideOrder.map((side) => (
                        <div key={side}>
                          <span className="sr-only">
                            {sides[side].label}, change {index + 1}:
                          </span>
                          <pre>{chunk[side].join("\n")}</pre>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="sidebar-empty">
              Denote combined every change automatically. Review the result
              below before marking it resolved.
            </p>
          )}
          <label className="source-control__field">
            <span>Merged result</span>
            <textarea
              value={draft}
              rows={10}
              spellCheck={false}
              disabled={busy}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setDraft(next);
                sent.current = next;
                onAction(action("edit-conflict-result", { result: next }));
              }}
            />
          </label>
          <p className="source-control__status" role="status">
            {detail.unsavedResult
              ? "This result has not been written to the vault yet."
              : "This is the result Denote merged from the three recorded sides."}
          </p>
          <div className="source-control__actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy || !resolvable}
              onClick={() => onAction(action("resolve-conflict"))}
            >
              Mark resolved
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !detail.unsavedResult}
              onClick={() => onAction(action("discard-conflict-result"))}
            >
              Discard result
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onAction(action("close-conflict"))}
            >
              Close conflict
            </button>
          </div>
          {resolvable ? null : (
            <p className="source-control__limitation" role="status">
              {detail.unresolvedChunks} change
              {detail.unresolvedChunks === 1 ? "" : "s"} still need
              {detail.unresolvedChunks === 1 ? "s" : ""} a side. Choose one for
              each, or edit the result yourself.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function sideHeading(side: PluginSourceControlConflictSideKind): string {
  return side === "base" ? "Base" : side === "ours" ? "Ours" : "Theirs";
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

function SourceControlPanelComponent({
  title,
  model,
  onAction,
  onOpenFile,
}: SourceControlPanelProps) {
  const { repository, remoteAccess } = model;
  const [commitMessage, setCommitMessage] = useState("");
  const [signCommit, setSignCommit] = useState(true);
  const [signingPassphrase, setSigningPassphrase] = useState("");
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
  const trackedChanges = model.resourceGroups
    .filter((group) => group.kind === "staged" || group.kind === "unstaged")
    .reduce((total, group) => total + group.resources.length, 0);
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
    setSignCommit(true);
    setSigningPassphrase("");
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
  const submitCommit = (push: boolean) => {
    const message = commitMessage.trim();
    if (!message) {
      return;
    }
    const values: Record<string, string | boolean> = {
      message,
      sign: signCommit,
    };
    if (push) {
      values.remote = activeRemote;
      values.branch = remoteBranch;
    }
    const commitAction = action(push ? "commit-and-push" : "commit", values);
    onAction(
      commitAction,
      signCommit && signingPassphrase
        ? { gitSigningPassphrase: signingPassphrase }
        : undefined,
    );
    setSigningPassphrase("");
  };

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
          aria-label="Refresh"
          title="Refresh"
          disabled={repository.busy}
          onClick={() => onAction(action("refresh"))}
        >
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </div>
      <div className="source-control__content">
        <WorkspaceRepositories
          repositories={model.workspaceRepositories ?? []}
          busy={repository.busy}
          onAction={onAction}
        />
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
          <SourceControlBranchPicker
            branches={branchOptions}
            currentBranch={selectedBranch}
            busy={repository.busy || !repository.initialized}
            onAction={onAction}
          />
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
                  aria-label="Fetch"
                  title="Fetch"
                  disabled={!canReachRemote}
                  onClick={() =>
                    onAction(action("fetch", { remote: activeRemote }))
                  }
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Pull"
                  title="Pull"
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
                  <ArrowDownToLine aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Push"
                  title="Push"
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
                  <ArrowUpFromLine aria-hidden="true" size={15} />
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
                aria-label="Cancel operation"
                title="Cancel operation"
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

        {model.operationProgress ? (
          <OperationProgress
            progress={model.operationProgress}
            busy={repository.busy}
            onAction={onAction}
          />
        ) : null}

        {model.operationPlan ? (
          <OperationPlan
            plan={model.operationPlan}
            busy={repository.busy}
            onAction={onAction}
          />
        ) : null}

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
                      submitCommit(false);
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
                    <label className="source-control__checkbox">
                      <input
                        type="checkbox"
                        checked={signCommit}
                        disabled={repository.busy}
                        onChange={(event) => {
                          setSignCommit(event.currentTarget.checked);
                          if (!event.currentTarget.checked) {
                            setSigningPassphrase("");
                          }
                        }}
                      />
                      <span>Sign commit</span>
                    </label>
                    {signCommit ? (
                      <label className="source-control__field">
                        <span>Signing passphrase (SSH keys only, optional)</span>
                        <input
                          type="password"
                          value={signingPassphrase}
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={4096}
                          disabled={repository.busy}
                          onChange={(event) =>
                            setSigningPassphrase(event.currentTarget.value)
                          }
                        />
                        <small>
                          Used once. OpenPGP and X.509 use the system agent or
                          pinentry.
                        </small>
                      </label>
                    ) : null}
                    <div className="source-control__actions">
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={
                          repository.busy ||
                          stagedChanges === 0 ||
                          commitMessage.trim().length === 0
                        }
                      >
                        Commit
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          repository.busy ||
                          stagedChanges === 0 ||
                          commitMessage.trim().length === 0 ||
                          !canReachRemote ||
                          remoteBranch.length === 0
                        }
                        onClick={() => submitCommit(true)}
                      >
                        Commit and push
                      </button>
                    </div>
                  </form>
                  <div
                    className="source-control__change-actions"
                    role="group"
                    aria-label="Change staging"
                  >
                    <button
                      type="button"
                      aria-label="Stage all changes"
                      title="Stage all changes"
                      disabled={
                        repository.busy ||
                        !model.resourceGroups.some(
                          (group) =>
                            (group.kind === "unstaged" ||
                              group.kind === "untracked") &&
                            group.resources.length > 0,
                        )
                      }
                      onClick={() => onAction(action("stage-all"))}
                    >
                      <ListPlus aria-hidden="true" size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Unstage all changes"
                      title="Unstage all changes"
                      disabled={repository.busy || stagedChanges === 0}
                      onClick={() => onAction(action("unstage-all"))}
                    >
                      <ListMinus aria-hidden="true" size={14} />
                    </button>
                    {repository.upstream ? (
                      <button
                        type="button"
                        aria-label={`Restore all tracked changes from ${repository.upstream}`}
                        title={`Restore all tracked changes from ${repository.upstream}`}
                        disabled={repository.busy || trackedChanges === 0}
                        onClick={() =>
                          onAction(action("restore-all-from-upstream"))
                        }
                      >
                        <Undo2 aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </div>
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
                        upstream={repository.upstream}
                      />
                    ))
                  ) : (
                    <p className="sidebar-empty">No working tree changes.</p>
                  )}
                  {model.conflictDetail ? (
                    <ConflictEditor
                      detail={model.conflictDetail}
                      busy={repository.busy}
                      onAction={onAction}
                    />
                  ) : selectedConflict ? (
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
                          Git recorded this file as binary content, so it has no
                          lines to merge. Open it to choose one whole recorded
                          side.
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
                        summaryOnly
                      />
                      <p className="source-control__status" role="status">
                        The patch is open as a temporary .diff tab in the editor.
                      </p>
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
                  <AdvancedOperations
                    branches={model.branches}
                    busy={repository.busy}
                    blocked={model.operationProgress !== null}
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
              {model.recovery.state === "running" ? null : (
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

export const SourceControlPanel = memo(SourceControlPanelComponent);
