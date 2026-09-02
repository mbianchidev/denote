import type {
  PluginGitCapability,
  PluginGitResult,
  PluginGitRunRequest,
  PluginSourceControlAction,
  PluginSourceControlBranchChoice,
  PluginSourceControlCommitDetail,
  PluginSourceControlDiffFile,
  PluginSourceControlHistoryEntry,
  PluginSourceControlHistoryPage,
  PluginSourceControlOperationReview,
  PluginSourceControlPendingBranchSwitch,
  PluginSourceControlRemoteAccess,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import {
  initialModel,
  refreshedModel,
  selectionOf,
  uninitializedModel,
  withBusy,
  withCommitDetail,
  withDiffFiles,
  withHistoryPage,
  withHistoryStatus,
  withPendingBranchSwitch,
  withRecovery,
  withRemoteAccess,
  withReview,
  withSelection,
  withoutCommitDetail,
  HISTORY_PAGE_SIZE,
  type GitRepositoryScope,
  type GitSelection,
} from "./model";
import {
  describeOperationState,
  parseBranches,
  parseDiscovery,
  parseHistory,
  parseOperationState,
  parseRemotes,
} from "./repositoryOutput";
import { DiffTooLarge, hunkRequest, parseUnifiedDiff, supportsHunkStaging } from "./diffOutput";
import { parseStatus } from "./statusOutput";
import { readGitSettings } from "./settings";

const MAX_REPORTED_ERROR_LENGTH = 200;
const REPOSITORY_LIST_LIMIT = 50;

/**
 * Why a merge commit is compared with its first parent.
 *
 * Git's own report for a merge is a combined diff, which describes two
 * comparisons at once and has no single pair of line numbers Denote could
 * render honestly. The first-parent comparison is one ordinary diff, so it is
 * read instead and labelled as exactly that.
 */
const MERGE_COMMIT_LIMITATION =
  "This is a merge commit. Denote shows how the merge result differs from its first parent, including what the merge brought into that branch. This view does not distinguish cleanly merged changes from merge-resolution edits.";

/**
 * Why an encrypted vault's history has no readable lines. Git records the
 * ciphertext, so every note reads as binary content and there is nothing
 * line-level to show for it.
 */
const ENCRYPTED_HISTORY_LIMITATION =
  "This vault is encrypted, so Git recorded ciphertext for these files. Denote reports them as binary changes and shows no line-level content.";

/**
 * Why an encrypted vault cannot stash. `git stash push --include-untracked`
 * removes every untracked file from the worktree, which in an encrypted vault
 * can take an untracked encryption manifest with it and leave the ciphertext
 * unreadable. The host refuses it too; saying so here is what keeps the
 * control off the surface instead of failing after the user presses it.
 */
const ENCRYPTED_STASH_LIMITATION =
  "This vault is encrypted, so Denote cannot stash while untracked files are present: stashing them would remove the vault's encryption manifest from disk. Commit them instead, or move them out of the vault.";

/**
 * Why an encrypted vault cannot stage by hunk. Git tracks ciphertext, so there
 * are no plaintext lines to choose between and a reconstructed patch describes
 * a change the repository does not hold. The host refuses both directions
 * natively; saying so here is what keeps the control off the surface instead of
 * failing after the user presses it.
 */
const ENCRYPTED_HUNK_LIMITATION =
  "This vault is encrypted, so Denote stages whole files: Git tracks the ciphertext, and a hunk of it is not a change Denote can apply. Use Stage or Unstage on the file instead.";

export interface GitControllerOptions {
  /** Publishes a model to the host. Called for every state change. */
  publish: (model: PluginSourceControlViewModel) => void;
  /** Reads this plugin's host-owned persisted settings. */
  readSettings: () => Promise<Record<string, unknown>>;
  /** Records operational messages. It never receives file or commit content. */
  report: (message: string, details?: Record<string, unknown>) => void;
}

class GitFailure extends Error {
  constructor(
    readonly operation: string,
    readonly exitCode: number,
    readonly detail: string,
  ) {
    super(`Git ${operation} failed with exit code ${exitCode}.`);
  }
}

/** Refuses an action that cannot be attempted, before any Git command runs. */
class GitRefused extends Error {}

class GitCancelled extends Error {
  constructor(readonly operationId: string) {
    super("The Git operation was cancelled.");
  }
}

/** Thrown when the scope changed while an operation was still running. */
class StaleScope extends Error {}

/**
 * A Git command failed after Denote had already moved the user's work
 * somewhere safe. The message says where the work is, so a failed step never
 * looks like lost work.
 */
class GitPreservedWork extends Error {
  constructor(
    readonly operation: string,
    message: string,
  ) {
    super(message);
  }
}

/** Which diff Denote is showing for the open path. */
type GitDiffTargetKind = "worktree" | "index";

/**
 * A checkout Denote prepared but did not run, and everything needed to run it
 * once the user says what should happen to the working tree.
 */
interface PendingBranchSwitch {
  request: PluginGitRunRequest;
  busyMessage: string;
  target: string;
  localBranch: string | null;
  fromBranch: string | null;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
}

/**
 * Owns one repository's view model.
 *
 * Every Git operation runs through {@link perform}, which publishes busy state
 * with the operation ID the host needs for cancellation, keeps the last stable
 * model when an operation fails, and discards any result that arrives after the
 * repository scope changed.
 */
export class GitRepositoryController {
  private scope: GitRepositoryScope;
  private current: PluginSourceControlViewModel;
  private stable: PluginSourceControlViewModel;
  private generation = 0;
  private busy = false;
  /**
   * The operation Git is running right now. A cancel action carries whatever ID
   * the surface last rendered, which a fast operation sequence has already
   * replaced, so cancellation targets this value instead of the payload.
   */
  private currentOperationId: string | null = null;
  /**
   * True while the host reports this scope is a sealed, unlocked encrypted
   * vault. It is read from `discover`, so it always describes the repository
   * that was last refreshed.
   */
  private encrypted = false;
  /** Which diff is on screen, and which side of the index it came from. */
  private openDiff: { path: string; target: GitDiffTargetKind } | null = null;
  /** Which page of history the model holds. Every refresh returns to page 0. */
  private historyPageIndex = 0;
  /**
   * Identifies the history read the model is allowed to accept.
   *
   * Paging and refreshing both replace the whole page, so a read that was
   * started before the latest one is stale by the time it lands: the token it
   * captured no longer matches, and its result is dropped instead of
   * overwriting newer commits with older ones.
   */
  private historyToken = 0;
  private pendingSwitch: PendingBranchSwitch | null = null;

  constructor(
    scope: GitRepositoryScope,
    private readonly options: GitControllerOptions,
  ) {
    this.scope = scope;
    this.current = initialModel(scope);
    this.stable = this.current;
  }

  get model(): PluginSourceControlViewModel {
    return this.current;
  }

  get repositoryId(): string {
    return this.scope.repositoryId;
  }

  /**
   * Points the provider at another repository. A different repository starts
   * from the unrefreshed model, so nothing read from the previous scope is ever
   * shown as if it belonged to the new one.
   *
   * `force` resets even when the scope identity is unchanged. A workspace
   * switch reaches the same vault-scoped identity from a different repository
   * on disk, so the model has to be discarded on identity alone.
   */
  setScope(scope: GitRepositoryScope, force = false): void {
    if (!force && scope.repositoryId === this.scope.repositoryId) {
      return;
    }
    this.scope = scope;
    this.generation += 1;
    this.busy = false;
    this.currentOperationId = null;
    this.encrypted = false;
    this.openDiff = null;
    this.historyPageIndex = 0;
    this.historyToken += 1;
    this.pendingSwitch = null;
    // Remote and clone state describes how the user signs in and what a failed
    // clone left behind. Neither belongs to the repository that was open, so
    // both survive a scope change while everything read from Git is discarded.
    this.current = initialModel(scope, this.remoteAccess);
    this.stable = this.current;
    this.options.publish(this.current);
    // Settings are host-persisted and can have been changed while another
    // vault was open, so the mode shown for the new scope is re-read rather
    // than carried over.
    void this.syncRemoteAccess();
  }

  /**
   * Re-reads the configured authentication mode and shows it.
   *
   * The mode is a host-owned Settings value, so this is the only thing that
   * ever changes it in the model: there is no action, and no plugin state, to
   * disagree with what every remote operation will actually use.
   */
  async syncRemoteAccess(): Promise<void> {
    const generation = this.generation;
    const authMode = await this.authMode();
    if (generation !== this.generation) {
      return;
    }
    const remoteAccess = this.remoteAccess;
    if (remoteAccess.authMode === authMode) {
      return;
    }
    this.publish(
      withRemoteAccess(this.current, {
        ...remoteAccess,
        authMode,
        githubAvailable: authMode === "github-https",
        // A listing was made under the previous mode, so it is dropped rather
        // than offered as if it still applied.
        repositories: authMode === "github-https" ? remoteAccess.repositories : [],
      }),
    );
  }

  private get remoteAccess(): PluginSourceControlRemoteAccess {
    return this.current.remoteAccess;
  }

  async runAction(
    action: PluginSourceControlAction,
    git: PluginGitCapability | undefined,
  ): Promise<void> {
    switch (action.id) {
      case "select-tab":
        this.selectTab(text(action, "tab"));
        return;
      case "open-commit":
        await this.withOperation(git, (capability, generation) =>
          this.openCommit(capability, generation, text(action, "commitId")),
        );
        return;
      case "close-commit":
        if (!this.busy) {
          this.publish(withoutCommitDetail(this.current));
        }
        return;
      case "refresh-history":
        await this.withOperation(git, (capability, generation) =>
          this.loadHistoryPage(capability, generation, this.historyPageIndex),
        );
        return;
      case "history-previous":
        await this.withOperation(git, (capability, generation) =>
          this.loadHistoryPage(
            capability,
            generation,
            this.historyPageIndex - 1,
          ),
        );
        return;
      case "history-next":
        await this.withOperation(git, (capability, generation) =>
          this.loadHistoryPage(
            capability,
            generation,
            this.historyPageIndex + 1,
          ),
        );
        return;
      case "dismiss":
        if (!this.busy) {
          this.publish(withRecovery(this.current, { state: "idle" }));
        }
        return;
      case "dismiss-review":
        if (!this.busy) {
          this.publish(withReview(this.current, null));
        }
        return;
      case "select-repository":
        this.selectRepository(
          text(action, "nameWithOwner"),
          text(action, "url"),
        );
        return;
      case "cancel-operation":
        await this.cancel(text(action, "operationId"), git);
        return;
      case "refresh":
        await this.withOperation(git, (capability, generation) =>
          this.refresh(capability, generation),
        );
        return;
      case "initialize":
        await this.withOperation(git, (capability, generation) =>
          this.initialize(capability, generation),
        );
        return;
      case "stage":
      case "unstage": {
        const operation = action.id === "stage" ? "stage" : "unstage";
        const path = text(action, "path");
        await this.withOperation(git, async (capability, generation) => {
          if (!path) {
            throw new GitRefused("No file path was supplied for this action.");
          }
          await this.perform(
            capability,
            generation,
            operation === "stage" ? "Staging a change" : "Unstaging a change",
            { operation, scope: this.scope.kind, paths: [path] },
          );
          await this.refresh(capability, generation);
        });
        return;
      }
      case "commit":
        await this.withOperation(git, (capability, generation) =>
          this.commit(capability, generation, text(action, "message")),
        );
        return;
      case "open-diff":
        await this.withOperation(git, (capability, generation) =>
          this.openDiffFor(
            capability,
            generation,
            text(action, "path"),
            text(action, "group"),
          ),
        );
        return;
      case "close-diff":
        if (!this.busy) {
          this.openDiff = null;
          this.publish(
            withDiffFiles(this.current, [], {
              tab: "changes",
              view: { kind: "repository" },
            }),
          );
        }
        return;
      case "stage-hunk":
      case "unstage-hunk": {
        const operation = action.id === "stage-hunk" ? "stage-hunk" : "unstage-hunk";
        const path = text(action, "path");
        const index = integer(action, "hunk");
        await this.withOperation(git, (capability, generation) =>
          this.applyHunk(capability, generation, operation, path, index),
        );
        return;
      }
      case "create-branch":
        await this.withOperation(git, (capability, generation) =>
          this.createBranch(
            capability,
            generation,
            text(action, "name"),
            text(action, "startPoint"),
            flag(action, "checkout"),
          ),
        );
        return;
      case "switch-branch":
        await this.withOperation(git, (capability, generation) =>
          this.switchBranch(capability, generation, text(action, "branch")),
        );
        return;
      case "checkout-remote-branch":
        await this.withOperation(git, (capability, generation) =>
          this.checkoutRemoteBranch(
            capability,
            generation,
            text(action, "remoteBranch"),
            text(action, "localName"),
          ),
        );
        return;
      case "rename-branch":
        await this.withOperation(git, (capability, generation) =>
          this.renameBranch(
            capability,
            generation,
            text(action, "name"),
            text(action, "newName"),
          ),
        );
        return;
      case "delete-branch":
        await this.withOperation(git, (capability, generation) =>
          this.deleteBranch(capability, generation, text(action, "name")),
        );
        return;
      case "branch-switch-commit":
        await this.withOperation(git, (capability, generation) =>
          this.resolvePendingByCommitting(
            capability,
            generation,
            text(action, "message"),
          ),
        );
        return;
      case "branch-switch-stash":
        await this.withOperation(git, (capability, generation) =>
          this.resolvePendingByStashing(capability, generation),
        );
        return;
      case "branch-switch-cancel":
        if (!this.busy) {
          this.pendingSwitch = null;
          this.publish(withPendingBranchSwitch(this.stable, null));
        }
        return;
      case "fetch":
        await this.withOperation(git, (capability, generation) =>
          this.fetch(capability, generation, text(action, "remote")),
        );
        return;
      case "pull":
        await this.withOperation(git, (capability, generation) =>
          this.pull(
            capability,
            generation,
            text(action, "remote"),
            text(action, "branch"),
          ),
        );
        return;
      case "push":
        await this.withOperation(git, (capability, generation) =>
          this.push(
            capability,
            generation,
            text(action, "remote"),
            text(action, "branch"),
          ),
        );
        return;
      case "add-remote":
      case "set-remote-url": {
        const operation = action.id;
        await this.withOperation(git, (capability, generation) =>
          this.writeRemote(
            capability,
            generation,
            operation,
            text(action, "name"),
            text(action, "url"),
          ),
        );
        return;
      }
      case "remove-remote":
        await this.withOperation(git, (capability, generation) =>
          this.removeRemote(capability, generation, text(action, "name")),
        );
        return;
      case "browse-github":
        await this.withOperation(git, (capability) =>
          this.browseGitHub(capability),
        );
        return;
      case "clone":
        await this.withOperation(git, (capability) =>
          this.clone(capability, text(action, "url"), text(action, "branch")),
        );
        return;
      case "clean-failed-clone":
        await this.withOperation(git, (capability) =>
          this.cleanFailedClone(capability, text(action, "token")),
        );
        return;
      default:
        this.reportUnsupported(action.id);
    }
  }

  /**
   * Records the selected repository for review. The URL is filled into the
   * clone form by the host surface; nothing is contacted here.
   */
  private selectRepository(nameWithOwner: string, url: string): void {
    if (!nameWithOwner || !url) {
      return;
    }
    this.publish(
      withReview(this.current, {
        operation: "Repository selected",
        outcome: "succeeded",
        summary: `${nameWithOwner} is ready to clone.`,
        detail: null,
      }),
    );
  }

  private selectTab(tab: string): void {
    const selection: GitSelection | null =
      tab === "changes"
        ? { tab: "changes", view: { kind: "repository" } }
        : tab === "history"
          ? { tab: "history", view: { kind: "history" } }
          : tab === "branches"
            ? { tab: "branches", view: { kind: "branches" } }
            : null;
    if (!selection) {
      return;
    }
    // Selecting a tab is a view change only: it never runs Git.
    this.publish(withSelection(this.current, selection));
  }

  /**
   * Reads one bounded page of commits and publishes it.
   *
   * One commit beyond the page is asked for, and never shown, so the surface
   * learns whether an older page exists without any unbounded count. A result
   * that lands after another history read started, or after the scope changed,
   * is dropped rather than published over newer commits.
   */
  private async loadHistoryPage(
    git: PluginGitCapability,
    generation: number,
    pageIndex: number,
  ): Promise<void> {
    if (pageIndex < 0) {
      return;
    }
    const token = ++this.historyToken;
    this.publish(withHistoryStatus(this.current, { loading: true, error: null }));
    let page: {
      entries: PluginSourceControlHistoryEntry[];
      page: PluginSourceControlHistoryPage;
    };
    try {
      page = await this.readHistoryPage(git, generation, pageIndex);
    } catch (error) {
      if (error instanceof StaleScope) {
        this.options.report("Discarded a stale history page.");
        throw error;
      }
      // A failure is reported from the last settled model, so that model must
      // not still say a read is running: every pager control is disabled while
      // it does, which would leave the history with no way to read itself
      // again once the failure is dismissed.
      if (generation === this.generation) {
        this.publish(withHistoryStatus(this.stable, { loading: false }));
      }
      throw error;
    }
    if (token !== this.historyToken || generation !== this.generation) {
      this.options.report("Discarded a stale history page.");
      return;
    }
    if (page.entries.length === 0 && pageIndex > 0) {
      // The log ended between reading the previous page and this one, so the
      // commits on screen stay and the page that does not exist is refused.
      this.publish(
        withHistoryStatus(this.stable, {
          loading: false,
          error:
            "There are no more commits to show. Refresh history to read this repository again.",
        }),
      );
      return;
    }
    this.historyPageIndex = pageIndex;
    this.publish(withHistoryPage(this.stable, page.entries, page.page));
  }

  private async readHistoryPage(
    git: PluginGitCapability,
    generation: number,
    pageIndex: number,
  ): Promise<{
    entries: PluginSourceControlHistoryEntry[];
    page: PluginSourceControlHistoryPage;
  }> {
    const skip = pageIndex * HISTORY_PAGE_SIZE;
    const result = await this.perform(git, generation, "Reading history", {
      operation: "list-history",
      scope: this.scope.kind,
      // One commit more than the page is read purely to answer "is there an
      // older page?". It is never published.
      maxCount: HISTORY_PAGE_SIZE + 1,
      ...(skip > 0 ? { skip } : {}),
    });
    const parsed = parseHistory(result.stdout);
    return {
      entries: parsed.slice(0, HISTORY_PAGE_SIZE),
      page: {
        pageIndex,
        pageSize: HISTORY_PAGE_SIZE,
        hasPrevious: pageIndex > 0,
        hasNext: parsed.length > HISTORY_PAGE_SIZE,
        loading: false,
        error: null,
      },
    };
  }

  /**
   * Reads the exact diff for one commit of the loaded page.
   *
   * A commit is identified by the hash of its own content, so its diff cannot
   * change: only a commit the model already read is opened, and Git is asked
   * for that one revision. A merge has no single ordinary diff, so it is read
   * as the comparison with its first parent and labelled as that.
   */
  private async openCommit(
    git: PluginGitCapability,
    generation: number,
    commitId: string,
  ): Promise<void> {
    if (!commitId) {
      throw new GitRefused("No commit was supplied for this action.");
    }
    const entry = this.current.history.find((item) => item.id === commitId);
    if (!entry) {
      throw new GitRefused(
        "That commit is not in the history page Denote has read. Refresh history and retry.",
      );
    }
    const firstParent = entry.parentIds[0];
    const merge = entry.parentIds.length > 1 && firstParent !== undefined;
    const result = await this.perform(
      git,
      generation,
      `Reading commit ${entry.shortId}`,
      {
        operation: "diff",
        scope: this.scope.kind,
        target: merge
          ? { kind: "range", fromCommit: firstParent, toCommit: entry.id }
          : { kind: "commit", commit: entry.id },
      },
    );
    let files: PluginSourceControlDiffFile[];
    try {
      files = parseUnifiedDiff(result.stdout);
    } catch (error) {
      if (error instanceof DiffTooLarge) {
        throw new GitRefused(error.message);
      }
      throw error;
    }
    this.publish(
      withCommitDetail(this.stable, {
        commit: entry,
        files,
        limitation: merge
          ? MERGE_COMMIT_LIMITATION
          : this.encrypted && files.some((file) => file.binary)
            ? ENCRYPTED_HISTORY_LIMITATION
            : null,
      }),
    );
  }

  private async cancel(
    requestedOperationId: string,
    git: PluginGitCapability | undefined,
  ): Promise<void> {
    if (!git) {
      this.reportMissingCapability();
      return;
    }
    // The running operation is authoritative. A payload that names an operation
    // that already finished would otherwise cancel nothing while the user
    // watches the next step of the same sequence keep running.
    const operationId = this.currentOperationId ?? requestedOperationId;
    if (!operationId) {
      return;
    }
    this.options.report("Cancelling a Git operation.");
    let result: PluginGitResult;
    try {
      result = await git.cancel(operationId);
    } catch (error) {
      this.publish(
        withRecovery(this.stable, {
          state: "failed",
          operationId,
          message: `Denote could not cancel the running operation. ${describe(error)}`,
          retryActionId: "refresh",
          dismissActionId: "dismiss",
        }),
      );
      return;
    }
    if (result.cancelled) {
      return;
    }
    // Nothing matched the ID, so no operation is going to stop. Saying so is
    // the only way the user learns that the button did not work.
    this.options.report("A Git operation could not be cancelled.");
    this.publish(
      withRecovery(this.stable, {
        state: "failed",
        operationId,
        message:
          "Denote could not cancel this Git operation because it is no longer running, or it had already finished. Refresh to read the repository again.",
        retryActionId: "refresh",
        dismissActionId: "dismiss",
      }),
    );
  }

  private async withOperation(
    git: PluginGitCapability | undefined,
    run: (git: PluginGitCapability, generation: number) => Promise<void>,
  ): Promise<void> {
    if (!git) {
      this.reportMissingCapability();
      return;
    }
    if (this.busy) {
      this.options.report("Ignored an action while Git was already running.");
      return;
    }
    const generation = this.generation;
    this.busy = true;
    try {
      await run(git, generation);
    } catch (error) {
      // A message that says where the user's work was preserved is published
      // whatever happened to the scope in the meantime. Dropping it because
      // the repository changed would leave a commit or a stash entry nobody
      // was ever told about.
      if (generation === this.generation || error instanceof GitPreservedWork) {
        this.publishFailure(error);
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.currentOperationId = null;
      }
    }
  }

  private async refresh(
    git: PluginGitCapability,
    generation: number,
  ): Promise<void> {
    const discover = await this.perform(
      git,
      generation,
      "Looking for a repository",
      { operation: "discover", scope: this.scope.kind },
    );
    const discovery = parseDiscovery(discover.stdout);
    this.encrypted = discovery.encrypted;
    if (!discovery.initialized) {
      this.openDiff = null;
      this.pendingSwitch = null;
      this.historyPageIndex = 0;
      this.historyToken += 1;
      this.publish(uninitializedModel(this.scope, this.remoteAccess));
      return;
    }
    const status = await this.perform(
      git,
      generation,
      "Reading the working tree",
      { operation: "status", scope: this.scope.kind },
    );
    const branches = await this.perform(git, generation, "Reading branches", {
      operation: "list-branches",
      scope: this.scope.kind,
    });
    const remotes = await this.perform(git, generation, "Reading remotes", {
      operation: "list-remotes",
      scope: this.scope.kind,
    });
    const state = await this.perform(
      git,
      generation,
      "Reading the operation state",
      { operation: "operation-state", scope: this.scope.kind },
    );
    const history = await this.perform(git, generation, "Reading history", {
      operation: "list-history",
      scope: this.scope.kind,
      maxCount: HISTORY_PAGE_SIZE + 1,
    });
    // A refresh describes the repository as it is now, so it always returns to
    // the newest page instead of leaving the user on a page of a log that may
    // have moved underneath it.
    const parsed = parseHistory(history.stdout);
    const entries = parsed.slice(0, HISTORY_PAGE_SIZE);
    this.historyPageIndex = 0;
    this.historyToken += 1;
    // An open diff is re-read in the same pass, so what is on screen after an
    // action always describes the repository this refresh just read.
    const diffFiles = await this.readOpenDiff(git, generation);
    this.publish(
      refreshedModel(this.scope, selectionOf(this.current), {
        status: parseStatus(status.stdout),
        branches: parseBranches(branches.stdout),
        remotes: parseRemotes(remotes.stdout),
        history: entries,
        historyPage: {
          pageIndex: 0,
          pageSize: HISTORY_PAGE_SIZE,
          hasPrevious: false,
          hasNext: parsed.length > HISTORY_PAGE_SIZE,
          loading: false,
          error: null,
        },
        commitDetail: preservedCommitDetail(this.current, entries),
        diffFiles,
        diffSource: this.openDiff ? { kind: this.openDiff.target } : null,
        recovery: interruptedOperation(state.stdout),
        remoteAccess: this.remoteAccess,
        pendingBranchSwitch: this.current.pendingBranchSwitch,
      }),
    );
  }

  /**
   * Re-reads the diff that is on screen, if any. A path that no longer has any
   * difference to show closes the diff rather than leaving stale content
   * behind.
   */
  private async readOpenDiff(
    git: PluginGitCapability,
    generation: number,
  ): Promise<PluginSourceControlDiffFile[]> {
    const open = this.openDiff;
    if (!open) {
      return [];
    }
    const files = await this.readDiff(git, generation, open.path, open.target);
    if (files.length === 0) {
      this.openDiff = null;
    }
    return files;
  }

  private async readDiff(
    git: PluginGitCapability,
    generation: number,
    path: string,
    target: GitDiffTargetKind,
  ): Promise<PluginSourceControlDiffFile[]> {
    const result = await this.perform(
      git,
      generation,
      `Reading the diff for ${path}`,
      {
        operation: "diff",
        scope: this.scope.kind,
        target: target === "index" ? { kind: "index" } : { kind: "worktree" },
        paths: [path],
      },
    );
    try {
      // Git was asked for one path, so anything else in the report would be a
      // file this action never named.
      return parseUnifiedDiff(result.stdout).filter(
        (file) => file.path === path,
      );
    } catch (error) {
      if (error instanceof DiffTooLarge) {
        throw new GitRefused(error.message);
      }
      throw error;
    }
  }

  /**
   * Opens the diff for one changed path.
   *
   * The group the row came from decides which diff is read: a staged row is
   * the index against the last commit, and any other row is the working tree
   * against the index. An untracked file has no tracked side to compare, so it
   * is refused instead of shown as an empty diff.
   */
  private async openDiffFor(
    git: PluginGitCapability,
    generation: number,
    path: string,
    group: string,
  ): Promise<void> {
    if (!path) {
      throw new GitRefused("No file path was supplied for this action.");
    }
    if (group === "untracked") {
      throw new GitRefused(
        "This file is not tracked yet, so Git has nothing to compare it with. Stage it first to see it as a diff.",
      );
    }
    const target: GitDiffTargetKind = group === "staged" ? "index" : "worktree";
    const files = await this.readDiff(git, generation, path, target);
    if (files.length === 0) {
      throw new GitRefused(
        `Git reports no ${target === "index" ? "staged" : "unstaged"} changes for ${path}.`,
      );
    }
    this.openDiff = { path, target };
    this.publish(
      withDiffFiles(
        this.stable,
        files,
        { tab: "changes", view: { kind: "diff", path } },
        { kind: target },
      ),
    );
  }

  /**
   * Stages, or unstages, one hunk of the open diff.
   *
   * The hunk is taken from the model that is on screen, so the exact lines the
   * user is looking at are the ones sent. Only the structured hunk crosses the
   * boundary: the host rebuilds the patch for that one path itself.
   */
  private async applyHunk(
    git: PluginGitCapability,
    generation: number,
    operation: "stage-hunk" | "unstage-hunk",
    path: string,
    index: number,
  ): Promise<void> {
    // A commit's diff is a record of what already happened, so no hunk of it
    // can be staged. Saying so is what keeps a history selection from reaching
    // the working-tree path below at all.
    if (this.current.diffSource?.kind === "commit") {
      throw new GitRefused(
        "A commit's diff is history, not a change Denote can stage. Open the file on the Changes tab to stage part of it.",
      );
    }
    const file = this.current.diffFiles.find((entry) => entry.path === path);
    if (!file) {
      throw new GitRefused(
        "That diff is no longer open. Open it again and retry.",
      );
    }
    // The host refuses this outright for an encrypted vault, because a hunk of
    // ciphertext is not a change it can apply. Saying so here means the user
    // reads why rather than a Git exit code.
    if (this.encrypted) {
      throw new GitRefused(ENCRYPTED_HUNK_LIMITATION);
    }
    // Staging works forwards from the working tree into the index, and
    // unstaging works backwards from the index to the last commit. Applying
    // one direction to the other side's diff would search the index for a
    // block it was never meant to change.
    const expected = operation === "stage-hunk" ? "worktree" : "index";
    if (this.openDiff?.path !== path || this.openDiff.target !== expected) {
      throw new GitRefused(
        operation === "stage-hunk"
          ? `Open the unstaged diff for ${path} before staging one of its hunks.`
          : `Open the staged diff for ${path} before unstaging one of its hunks.`,
      );
    }
    if (!supportsHunkStaging(file)) {
      throw new GitRefused(
        "Denote stages whole files for binary, added, deleted, renamed, and copied changes. Use Stage or Unstage on the file instead.",
      );
    }
    const hunk = file.hunks[index];
    if (!hunk) {
      throw new GitRefused(
        "That hunk is no longer part of this diff. Refresh and retry.",
      );
    }
    await this.perform(
      git,
      generation,
      operation === "stage-hunk" ? "Staging a hunk" : "Unstaging a hunk",
      {
        operation,
        scope: this.scope.kind,
        path,
        hunk: hunkRequest(hunk),
      },
    );
    await this.refresh(git, generation);
    this.reviewed(
      operation === "stage-hunk" ? "Stage hunk" : "Unstage hunk",
      "succeeded",
      `${hunk.header} in ${path}`,
    );
  }

  private async initialize(
    git: PluginGitCapability,
    generation: number,
  ): Promise<void> {
    const discover = await this.perform(
      git,
      generation,
      "Looking for a repository",
      { operation: "discover", scope: this.scope.kind },
    );
    // A repository that already exists is refreshed instead of re-initialized.
    if (!parseDiscovery(discover.stdout).initialized) {
      const settings = readGitSettings(await this.options.readSettings());
      await this.perform(git, generation, "Creating a repository", {
        operation: "initialize",
        scope: this.scope.kind,
        defaultBranch: settings.defaultBranch,
      });
      this.options.report("Created a repository.");
    }
    await this.refresh(git, generation);
  }

  private async commit(
    git: PluginGitCapability,
    generation: number,
    message: string,
  ): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new GitRefused("A commit needs a message.");
    }
    const staged =
      this.current.resourceGroups.find((group) => group.kind === "staged")
        ?.resources.length ?? 0;
    if (staged === 0) {
      throw new GitRefused(
        "Stage at least one change before committing. Denote commits only staged changes.",
      );
    }
    const settings = readGitSettings(await this.options.readSettings());
    const request: PluginGitRunRequest = settings.identity
      ? {
          operation: "commit",
          scope: this.scope.kind,
          message: trimmed,
          authorName: settings.identity.authorName,
          authorEmail: settings.identity.authorEmail,
        }
      : { operation: "commit", scope: this.scope.kind, message: trimmed };
    await this.perform(git, generation, "Committing staged changes", request);
    this.options.report("Committed staged changes.", {
      identity: settings.identity ? "configured" : "repository",
    });
    await this.refresh(git, generation);
  }

  /**
   * Creates a branch from the current branch, a local branch, or a
   * remote-tracking branch, and optionally checks it out straight away.
   *
   * Creating a branch never touches the working tree, so it runs immediately.
   * Checking one out does, so it goes through the same review every other
   * checkout does.
   */
  private async createBranch(
    git: PluginGitCapability,
    generation: number,
    name: string,
    startPoint: string,
    checkout: boolean,
  ): Promise<void> {
    const branch = requireBranchName(name, "A new branch needs a name.");
    this.refuseExistingLocalBranch(branch);
    const start = startPoint.trim();
    if (start) {
      this.requireKnownBranch(start);
    }
    const request: PluginGitRunRequest = {
      operation: "create-branch",
      scope: this.scope.kind,
      name: branch,
      ...(start ? { startPoint: start } : {}),
      ...(checkout ? { checkout: true } : {}),
    };
    if (!checkout) {
      await this.perform(git, generation, `Creating ${branch}`, request);
      await this.refresh(git, generation);
      this.reviewed(
        "Create branch",
        "succeeded",
        `Created ${branch}${start ? ` from ${start}` : ""}. You are still on ${
          this.current.repository.branch ?? "the current branch"
        }.`,
      );
      return;
    }
    await this.beginCheckout(git, generation, {
      request,
      busyMessage: `Creating and checking out ${branch}`,
      target: start || currentBranchName(this.current),
      localBranch: branch,
    });
  }

  /** Checks out a branch that already exists locally. */
  private async switchBranch(
    git: PluginGitCapability,
    generation: number,
    name: string,
  ): Promise<void> {
    const branch = requireBranchName(
      name,
      "Choose the branch to switch to first.",
    );
    const known = this.current.branches.find(
      (entry) => entry.name === branch && !entry.remote,
    );
    if (known?.current) {
      throw new GitRefused(`You are already on ${branch}.`);
    }
    if (!known && this.current.branches.some((entry) => entry.name === branch)) {
      throw new GitRefused(
        `${branch} is a remote-tracking branch. Use "Check out" on the Branches tab to create a local branch that follows it.`,
      );
    }
    await this.beginCheckout(git, generation, {
      request: {
        operation: "checkout-branch",
        scope: this.scope.kind,
        name: branch,
      },
      busyMessage: `Switching to ${branch}`,
      target: branch,
      localBranch: null,
    });
  }

  /**
   * Creates a local branch that follows a remote-tracking branch and checks it
   * out.
   *
   * The local name is proposed by stripping the remote from the tracking
   * branch, and a name that is already taken is reported rather than reused,
   * because reusing it would silently check out a different branch than the
   * one that was asked for.
   */
  private async checkoutRemoteBranch(
    git: PluginGitCapability,
    generation: number,
    remoteBranch: string,
    localName: string,
  ): Promise<void> {
    const tracking = requireBranchName(
      remoteBranch,
      "Choose the remote branch to check out first.",
    );
    const known = this.current.branches.find(
      (entry) => entry.name === tracking && entry.remote,
    );
    if (!known) {
      throw new GitRefused(
        `${tracking} is not a remote-tracking branch in this repository. Fetch first, then try again.`,
      );
    }
    const local = (localName.trim() || localBranchNameFor(tracking)).trim();
    if (!local) {
      throw new GitRefused(
        `Denote could not work out a local branch name for ${tracking}. Type one instead.`,
      );
    }
    this.refuseExistingLocalBranch(local, tracking);
    await this.beginCheckout(git, generation, {
      request: {
        operation: "create-branch",
        scope: this.scope.kind,
        name: local,
        startPoint: tracking,
        checkout: true,
      },
      busyMessage: `Checking out ${local} from ${tracking}`,
      target: tracking,
      localBranch: local,
    });
  }

  /** Renames a local branch. Remote-tracking branches are never touched. */
  private async renameBranch(
    git: PluginGitCapability,
    generation: number,
    name: string,
    newName: string,
  ): Promise<void> {
    const branch = requireBranchName(name, "Choose the branch to rename.");
    const renamed = requireBranchName(newName, "A rename needs a new name.");
    this.requireLocalBranch(branch, "rename");
    if (branch === renamed) {
      throw new GitRefused(`${branch} already has that name.`);
    }
    this.refuseExistingLocalBranch(renamed);
    await this.perform(
      git,
      generation,
      `Renaming ${branch} to ${renamed}`,
      {
        operation: "rename-branch",
        scope: this.scope.kind,
        name: branch,
        newName: renamed,
      },
    );
    await this.refresh(git, generation);
    this.reviewed(
      "Rename branch",
      "succeeded",
      `${branch} is now ${renamed}. Its commits are unchanged.`,
    );
  }

  /**
   * Deletes a local branch. The branch that is checked out is refused, because
   * deleting it would leave the repository with no current branch, and Denote
   * never forces a deletion that would discard unmerged commits.
   */
  private async deleteBranch(
    git: PluginGitCapability,
    generation: number,
    name: string,
  ): Promise<void> {
    const branch = requireBranchName(name, "Choose the branch to delete.");
    const known = this.requireLocalBranch(branch, "delete");
    if (known.current) {
      throw new GitRefused(
        `${branch} is the branch you are on, so Denote will not delete it. Switch to another branch first.`,
      );
    }
    await this.perform(git, generation, `Deleting ${branch}`, {
      operation: "delete-branch",
      scope: this.scope.kind,
      name: branch,
    });
    await this.refresh(git, generation);
    this.reviewed(
      "Delete branch",
      "succeeded",
      `${branch} was deleted. Its remote-tracking branch, if it has one, is unchanged.`,
    );
  }

  /**
   * Reads the working tree before a checkout and decides whether the checkout
   * may run at all.
   *
   * The repository is refreshed first, so the decision is made from what Git
   * reports now rather than from whatever the surface last displayed. A
   * conflict is refused outright; any other change publishes a review that
   * offers to commit the listed paths, to stash them, or to cancel. Nothing is
   * ever discarded, and no checkout runs until the user answers.
   */
  private async beginCheckout(
    git: PluginGitCapability,
    generation: number,
    plan: {
      request: PluginGitRunRequest;
      busyMessage: string;
      target: string;
      localBranch: string | null;
    },
  ): Promise<void> {
    await this.refresh(git, generation);
    if (this.current.conflicts.length > 0) {
      throw new GitRefused(
        "This repository has unresolved conflicts, so Denote will not check anything out. Resolve or abort the conflicted operation with your own Git tooling, then refresh.",
      );
    }
    const staged = pathsIn(this.current, "staged");
    const unstaged = pathsIn(this.current, "unstaged");
    const untracked = pathsIn(this.current, "untracked");
    const pending: PendingBranchSwitch = {
      ...plan,
      fromBranch: this.current.repository.branch,
      stagedPaths: staged,
      unstagedPaths: unstaged,
      untrackedPaths: untracked,
    };
    if (staged.length + unstaged.length + untracked.length === 0) {
      this.pendingSwitch = null;
      await this.runCheckout(git, generation, pending);
      return;
    }
    this.pendingSwitch = pending;
    this.publish(
      withPendingBranchSwitch(this.current, this.describePending(pending)),
    );
  }

  private async runCheckout(
    git: PluginGitCapability,
    generation: number,
    plan: PendingBranchSwitch,
  ): Promise<void> {
    await this.perform(git, generation, plan.busyMessage, plan.request);
    this.pendingSwitch = null;
    // A checkout replaces files on disk, so the diff that was open described a
    // branch the user has left.
    this.openDiff = null;
    await this.refresh(git, generation);
    this.publish(withPendingBranchSwitch(this.current, null));
    const now = plan.localBranch ?? plan.target;
    this.reviewed("Switch branch", "succeeded", `You are now on ${now}.`);
  }

  /**
   * Commits every listed path and then checks out.
   *
   * Exactly the paths the review listed are staged, so nothing that appeared
   * afterwards is swept into the commit by accident.
   */
  private async resolvePendingByCommitting(
    git: PluginGitCapability,
    generation: number,
    message: string,
  ): Promise<void> {
    const plan = this.requirePendingSwitch();
    const trimmed = message.trim();
    if (!trimmed) {
      throw new GitRefused("Committing before a switch needs a message.");
    }
    const paths = [
      ...new Set([
        ...plan.stagedPaths,
        ...plan.unstagedPaths,
        ...plan.untrackedPaths,
      ]),
    ];
    if (paths.length === 0) {
      throw new GitRefused("There is nothing to commit before switching.");
    }
    await this.perform(git, generation, "Staging the listed changes", {
      operation: "stage",
      scope: this.scope.kind,
      paths,
    });
    const settings = readGitSettings(await this.options.readSettings());
    await this.perform(git, generation, "Committing before switching", {
      operation: "commit",
      scope: this.scope.kind,
      message: trimmed,
      ...(settings.identity
        ? {
            authorName: settings.identity.authorName,
            authorEmail: settings.identity.authorEmail,
          }
        : {}),
    });
    this.options.report("Committed before switching branches.", {
      paths: paths.length,
    });
    await this.preserveThroughCheckout(
      git,
      generation,
      plan,
      `Your work is committed on ${plan.fromBranch ?? "the branch you were on"}, so nothing is lost.`,
    );
  }

  /**
   * Stashes every listed path and then checks out.
   *
   * Untracked files are included only when the vault is not encrypted: in an
   * encrypted vault that would remove the encryption manifest from the
   * worktree, so stashing is not offered at all while untracked files exist.
   */
  private async resolvePendingByStashing(
    git: PluginGitCapability,
    generation: number,
  ): Promise<void> {
    const plan = this.requirePendingSwitch();
    const untracked = plan.untrackedPaths.length > 0;
    if (untracked && this.encrypted) {
      throw new GitRefused(ENCRYPTED_STASH_LIMITATION);
    }
    await this.perform(git, generation, "Stashing the listed changes", {
      operation: "stash",
      scope: this.scope.kind,
      action: "push",
      message: `Denote: before switching to ${plan.localBranch ?? plan.target}`,
      ...(untracked ? { includeUntracked: true } : {}),
    });
    this.options.report("Stashed changes before switching branches.");
    await this.preserveThroughCheckout(
      git,
      generation,
      plan,
      "Your work is in the most recent stash entry; restore it with your own Git tooling.",
    );
  }

  /**
   * Runs a checkout whose work has already been moved somewhere safe.
   *
   * Every failure from here on says where that work is, whatever stopped the
   * checkout: a failed Git command, a failed refresh, a cancellation, a
   * refusal, a host error, or a scope change part way through. A failed step
   * must never look like lost work, which is why the wrapper is not limited to
   * the failures Git itself reports.
   */
  private async preserveThroughCheckout(
    git: PluginGitCapability,
    generation: number,
    plan: PendingBranchSwitch,
    preserved: string,
  ): Promise<void> {
    try {
      await this.runCheckout(git, generation, plan);
    } catch (error) {
      if (error instanceof GitPreservedWork) {
        throw error;
      }
      throw new GitPreservedWork(
        operationOf(error) ?? plan.request.operation,
        `${describePreserved(error)} ${preserved}`.trim(),
      );
    }
  }

  private requirePendingSwitch(): PendingBranchSwitch {
    if (!this.pendingSwitch) {
      throw new GitRefused(
        "There is no branch switch waiting for an answer. Start the switch again.",
      );
    }
    return this.pendingSwitch;
  }

  private describePending(
    plan: PendingBranchSwitch,
  ): PluginSourceControlPendingBranchSwitch {
    const blockedByEncryption =
      this.encrypted && plan.untrackedPaths.length > 0;
    return {
      target: plan.target,
      localBranch: plan.localBranch,
      fromBranch: plan.fromBranch,
      stagedPaths: plan.stagedPaths,
      unstagedPaths: plan.unstagedPaths,
      untrackedPaths: plan.untrackedPaths,
      commitAvailable: true,
      stashAvailable: !blockedByEncryption,
      stashUnavailableReason: blockedByEncryption
        ? ENCRYPTED_STASH_LIMITATION
        : null,
      commitActionId: "branch-switch-commit",
      stashActionId: "branch-switch-stash",
      cancelActionId: "branch-switch-cancel",
    };
  }

  private requireLocalBranch(
    name: string,
    verb: string,
  ): PluginSourceControlBranchChoice {
    const known = this.current.branches.find(
      (entry) => entry.name === name && !entry.remote,
    );
    if (!known) {
      throw new GitRefused(
        `Denote can only ${verb} local branches, and ${name} is not one of this repository's local branches.`,
      );
    }
    return known;
  }

  private requireKnownBranch(name: string): PluginSourceControlBranchChoice {
    const known = this.current.branches.find((entry) => entry.name === name);
    if (!known) {
      throw new GitRefused(
        `${name} is not a branch in this repository. Refresh, then choose a start point from the list.`,
      );
    }
    return known;
  }

  private refuseExistingLocalBranch(name: string, from?: string): void {
    if (
      !this.current.branches.some(
        (entry) => entry.name === name && !entry.remote,
      )
    ) {
      return;
    }
    throw new GitRefused(
      from
        ? `This repository already has a local branch called ${name}, so Denote will not point it at ${from}. Switch to ${name}, or type another name.`
        : `This repository already has a local branch called ${name}. Choose another name.`,
    );
  }

  /**
   * Fetches from one remote. A fetch is always explicit: nothing in this
   * plugin schedules, retries, or triggers one on its own.
   */
  private async fetch(
    git: PluginGitCapability,
    generation: number,
    remote: string,
  ): Promise<void> {
    const name = requireRemote(remote);
    const authMode = await this.authMode();
    await this.perform(git, generation, `Fetching from ${name}`, {
      operation: "fetch",
      scope: this.scope.kind,
      remote: name,
      prune: true,
      authMode,
    });
    await this.refresh(git, generation);
    this.reviewed("Fetch", "succeeded", `Fetched from ${name}.`);
  }

  private async pull(
    git: PluginGitCapability,
    generation: number,
    remote: string,
    branch: string,
  ): Promise<void> {
    const name = requireRemote(remote);
    const target = requireBranch(branch);
    const settings = readGitSettings(await this.options.readSettings());
    await this.perform(git, generation, `Pulling ${target} from ${name}`, {
      operation: "pull",
      scope: this.scope.kind,
      remote: name,
      branch: target,
      strategy: settings.pullStrategy,
      authMode: settings.authMode,
    });
    await this.refresh(git, generation);
    this.reviewed("Pull", "succeeded", `Pulled ${target} from ${name}.`);
  }

  /**
   * Pushes the current branch. Only an ordinary push is ever issued: this
   * plugin never asks for a force push, with or without a lease.
   */
  private async push(
    git: PluginGitCapability,
    generation: number,
    remote: string,
    branch: string,
  ): Promise<void> {
    const name = requireRemote(remote);
    const target = requireBranch(branch);
    const authMode = await this.authMode();
    // A branch with no upstream records one on its first push, so the next
    // fetch reports ahead and behind counts instead of nothing.
    const setUpstream = this.current.repository.upstream === null;
    await this.perform(git, generation, `Pushing ${target} to ${name}`, {
      operation: "push",
      scope: this.scope.kind,
      remote: name,
      branch: target,
      setUpstream,
      mode: "normal",
      authMode,
    });
    await this.refresh(git, generation);
    this.reviewed("Push", "succeeded", `Pushed ${target} to ${name}.`);
  }

  private async writeRemote(
    git: PluginGitCapability,
    generation: number,
    operation: "add-remote" | "set-remote-url",
    name: string,
    url: string,
  ): Promise<void> {
    const remote = requireRemote(name);
    const address = url.trim();
    if (!address) {
      throw new GitRefused("A remote needs a URL.");
    }
    await this.perform(
      git,
      generation,
      operation === "add-remote"
        ? `Adding the ${remote} remote`
        : `Changing the ${remote} remote`,
      { operation, scope: this.scope.kind, name: remote, url: address },
    );
    await this.refresh(git, generation);
    this.reviewed(
      operation === "add-remote" ? "Add remote" : "Change remote URL",
      "succeeded",
      `The "${remote}" remote now points at ${address}.`,
    );
  }

  private async removeRemote(
    git: PluginGitCapability,
    generation: number,
    name: string,
  ): Promise<void> {
    const remote = requireRemote(name);
    await this.perform(git, generation, `Removing the ${remote} remote`, {
      operation: "remove-remote",
      scope: this.scope.kind,
      name: remote,
    });
    await this.refresh(git, generation);
    this.reviewed(
      "Remove remote",
      "succeeded",
      `The "${remote}" remote was removed. Your commits and files are unchanged.`,
    );
  }

  /**
   * Lists repositories through the host's GitHub adapter. The host resolves
   * the GitHub CLI, obtains the token, and destroys it; only bounded metadata
   * comes back here.
   *
   * The listing's own operation ID is published before it is awaited, so the
   * surface can cancel a browse that is still running.
   */
  private async browseGitHub(git: PluginGitCapability): Promise<void> {
    const settings = readGitSettings(await this.options.readSettings());
    if (settings.authMode !== "github-https") {
      throw new GitRefused(
        "Remote authentication is not set to GitHub sign-in. Change it in Denote's plugin settings before browsing GitHub repositories.",
      );
    }
    const operation = git.listGitHubRepositories({
      limit: REPOSITORY_LIST_LIMIT,
    });
    this.currentOperationId = operation.operationId;
    this.publish(
      withBusy(
        this.current,
        "Reading GitHub repositories",
        operation.operationId,
      ),
    );
    let repositories;
    try {
      repositories = await operation.result;
    } finally {
      if (this.currentOperationId === operation.operationId) {
        this.currentOperationId = null;
      }
    }
    this.publish(
      withRemoteAccess(this.stable, {
        ...this.remoteAccess,
        authMode: settings.authMode,
        githubAvailable: true,
        repositories,
        review: {
          operation: "Browse GitHub",
          outcome: "succeeded",
          summary: `${repositories.length} repository${repositories.length === 1 ? "" : "s"} available to clone.`,
          detail: null,
        },
      }),
    );
    this.options.report("Listed GitHub repositories.", {
      count: repositories.length,
    });
  }

  /**
   * Clones into a folder the user picks in the host's own chooser. The plugin
   * never learns the destination: it receives a label, branch metadata, and,
   * when a clone fails, an opaque clean-up token.
   *
   * The clone's own operation ID is published before it is awaited, so Cancel
   * reaches the clone while the chooser, the credentials, or Git is running.
   */
  private async clone(
    git: PluginGitCapability,
    url: string,
    branch: string,
  ): Promise<void> {
    const address = url.trim();
    if (!address) {
      throw new GitRefused("A clone needs a repository URL.");
    }
    const settings = readGitSettings(await this.options.readSettings());
    const operation = git.cloneVault({
      url: address,
      authMode: settings.authMode,
      ...(branch.trim() ? { branch: branch.trim() } : {}),
    });
    this.currentOperationId = operation.operationId;
    this.publish(
      withBusy(this.current, "Cloning a repository", operation.operationId),
    );
    let outcome;
    try {
      outcome = await operation.result;
    } finally {
      if (this.currentOperationId === operation.operationId) {
        this.currentOperationId = null;
      }
    }
    if (outcome.status === "cancelled") {
      // Closing the folder chooser is an ordinary answer, not a failure.
      this.publish(
        withReview(this.stable, {
          operation: "Clone",
          outcome: "cancelled",
          summary: "No folder was chosen, so nothing was cloned.",
          detail: null,
        }),
      );
      return;
    }
    if (outcome.status === "failed") {
      this.options.report("A clone did not finish.");
      this.publish(
        withRemoteAccess(this.stable, {
          ...this.remoteAccess,
          cleanup: outcome.cleanupToken
            ? { token: outcome.cleanupToken, label: "the folder you chose" }
            : null,
          review: {
            operation: "Clone",
            outcome: "failed",
            summary: outcome.message,
            detail: outcome.cleanupToken
              ? "The folder is left exactly as it is. Retry the clone, or clean it up explicitly."
              : null,
            retryActionId: "refresh",
          },
        }),
      );
      return;
    }
    // The host has already opened the clone as the active vault, which resets
    // this provider's scope, so the review is all that is published here.
    this.options.report("Cloned a repository.");
    this.publish(
      withRemoteAccess(this.stable, {
        ...this.remoteAccess,
        cleanup: null,
        review: {
          operation: "Clone",
          outcome: "succeeded",
          summary: `${outcome.label} is open as a vault.`,
          detail: describeClone(outcome.branch, outcome.upstream),
        },
      }),
    );
  }

  private async cleanFailedClone(
    git: PluginGitCapability,
    token: string,
  ): Promise<void> {
    if (!token) {
      throw new GitRefused("There is no incomplete clone to clean up.");
    }
    const outcome = await git.cleanFailedClone(token);
    this.publish(
      withRemoteAccess(this.stable, {
        ...this.remoteAccess,
        // A spent token can never be offered again, whether or not the folder
        // was removed.
        cleanup: null,
        review: {
          operation: "Clean incomplete clone",
          outcome: outcome.cleaned ? "succeeded" : "failed",
          summary: outcome.message,
          detail: null,
        },
      }),
    );
  }

  /** Reads the configured authentication mode for one remote operation. */
  private async authMode(): Promise<PluginSourceControlRemoteAccess["authMode"]> {
    return readGitSettings(await this.options.readSettings()).authMode;
  }

  private reviewed(
    operation: string,
    outcome: PluginSourceControlOperationReview["outcome"],
    summary: string,
  ): void {
    this.publish(
      withReview(this.current, { operation, outcome, summary, detail: null }),
    );
  }

  /**
   * Runs one Git operation with visible progress. The operation ID is published
   * before the result is awaited, so the host can offer cancellation while the
   * operation is still running.
   */
  private async perform(
    git: PluginGitCapability,
    generation: number,
    busyMessage: string,
    request: PluginGitRunRequest,
  ): Promise<PluginGitResult> {
    // A scope change stops the next step of a running sequence, so no request
    // is ever issued against a repository the user already left.
    if (generation !== this.generation) {
      throw new StaleScope();
    }
    const operation = git.run(request);
    if (generation === this.generation) {
      this.currentOperationId = operation.operationId;
      this.publish(withBusy(this.current, busyMessage, operation.operationId));
    }
    try {
      const result = await operation.result;
      if (generation !== this.generation) {
        throw new StaleScope();
      }
      if (result.cancelled) {
        throw new GitCancelled(result.operationId);
      }
      if (result.exitCode !== 0) {
        throw new GitFailure(
          request.operation,
          result.exitCode,
          firstLine(result.stderr),
        );
      }
      return result;
    } finally {
      // Only the operation that set the ID may clear it. A later step of the
      // same sequence has already replaced it by the time this one settles.
      if (this.currentOperationId === operation.operationId) {
        this.currentOperationId = null;
      }
    }
  }

  private publishFailure(error: unknown): void {
    if (error instanceof StaleScope) {
      return;
    }
    if (error instanceof GitCancelled) {
      this.options.report("A Git operation was cancelled.");
      this.publish(
        withRecovery(this.stable, {
          state: "failed",
          operationId: error.operationId,
          message:
            "The Git operation was cancelled. The repository state shown may be out of date; refresh to read it again.",
          retryActionId: "refresh",
          dismissActionId: "dismiss",
        }),
      );
      return;
    }
    if (error instanceof GitRefused) {
      this.publish(
        withRecovery(this.stable, {
          state: "failed",
          operationId: "action-refused",
          message: error.message,
          dismissActionId: "dismiss",
        }),
      );
      return;
    }
    if (error instanceof GitPreservedWork) {
      this.options.report("A Git operation failed after work was preserved.", {
        operation: error.operation,
      });
      this.publish(
        withRecovery(this.stable, {
          state: "failed",
          operationId: `${error.operation}-preserved`,
          message: error.message,
          retryActionId: "refresh",
          dismissActionId: "dismiss",
        }),
      );
      return;
    }
    if (error instanceof GitFailure) {
      this.options.report("A Git operation failed.", {
        operation: error.operation,
        exitCode: error.exitCode,
      });
      this.publish(
        withRecovery(this.stable, {
          state: "failed",
          operationId: `${error.operation}-failure`,
          message: `${error.message} ${error.detail}`.trim(),
          retryActionId: "refresh",
          dismissActionId: "dismiss",
        }),
      );
      return;
    }
    this.options.report("A Git operation could not be completed.");
    this.publish(
      withRecovery(this.stable, {
        state: "failed",
        operationId: "git-failure",
        message: describe(error),
        retryActionId: "refresh",
        dismissActionId: "dismiss",
      }),
    );
  }

  private reportUnsupported(actionId: string): void {
    this.publish(
      withRecovery(this.stable, {
        state: "failed",
        operationId: `unsupported-${actionId}`,
        message: `Denote's Git plugin cannot ${describeAction(actionId)} yet. Use your own Git tooling for now.`,
        dismissActionId: "dismiss",
      }),
    );
  }

  private reportMissingCapability(): void {
    this.publish(
      withRecovery(this.stable, {
        state: "failed",
        operationId: "missing-git-permission",
        message:
          "The Git permission is not available, so Denote cannot run this action. Re-enable the plugin and approve the Git permission.",
        dismissActionId: "dismiss",
      }),
    );
  }

  private publish(model: PluginSourceControlViewModel): void {
    this.current = model;
    // A settled model is what a failure falls back to, so a failure never
    // replaces good data with an empty repository or with progress state.
    if (!model.repository.busy) {
      this.stable = model;
    }
    this.options.publish(model);
  }
}

/**
 * Reports an interrupted merge, rebase, cherry-pick, or revert. Denote cannot
 * continue, skip, or abort one yet, so the state is reported for the user to
 * finish rather than offered as an action.
 */
function interruptedOperation(
  stdout: string,
): PluginSourceControlViewModel["recovery"] {
  const state = parseOperationState(stdout);
  if (!state) {
    return { state: "idle" };
  }
  const interrupted = describeOperationState(state);
  if (!interrupted) {
    return { state: "idle" };
  }
  return {
    state: "failed",
    operationId: `operation-state-${interrupted}`,
    message: `This repository has a ${interrupted} in progress. Denote cannot continue, skip, or abort it yet; finish it with your own Git tooling, then refresh.`,
    retryActionId: "refresh",
    dismissActionId: "dismiss",
  };
}

/**
 * Keeps the open commit only while the page Denote just read still holds it.
 *
 * A commit is named by the hash of its own content, so a commit that is still
 * listed has exactly the diff that was already read and nothing has to be read
 * again. A commit that has left the page is dropped, because the model would
 * otherwise describe a commit its history no longer contains.
 */
function preservedCommitDetail(
  model: PluginSourceControlViewModel,
  history: PluginSourceControlHistoryEntry[],
): PluginSourceControlCommitDetail | null {
  const detail = model.commitDetail;
  if (!detail) {
    return null;
  }
  return history.some((entry) => entry.id === detail.commit.id) ? detail : null;
}

function describeAction(actionId: string): string {  switch (actionId) {
    case "open-conflict":
      return "resolve conflicts";
    case "continue":
    case "skip":
    case "abort":
      return `${actionId} an interrupted operation`;
    default:
      return `run "${actionId}"`;
  }
}

function text(action: PluginSourceControlAction, key: string): string {
  const value = action.values?.[key];
  return typeof value === "string" ? value : "";
}

function flag(action: PluginSourceControlAction, key: string): boolean {
  return action.values?.[key] === true;
}

function integer(action: PluginSourceControlAction, key: string): number {
  const value = action.values?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : -1;
}

function pathsIn(
  model: PluginSourceControlViewModel,
  kind: "staged" | "unstaged" | "untracked",
): string[] {
  const group = model.resourceGroups.find((entry) => entry.kind === kind);
  return group ? group.resources.map((resource) => resource.path) : [];
}

function currentBranchName(model: PluginSourceControlViewModel): string {
  return (
    model.branches.find((branch) => branch.current)?.name ??
    model.repository.branch ??
    "HEAD"
  );
}

/**
 * Proposes the local name for a remote-tracking branch by dropping the remote
 * it lives under: `origin/topic` becomes `topic`, and `origin/team/topic`
 * becomes `team/topic`.
 */
function localBranchNameFor(remoteBranch: string): string {
  const separator = remoteBranch.indexOf("/");
  return separator === -1 ? remoteBranch : remoteBranch.slice(separator + 1);
}

function requireBranchName(name: string, refusal: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new GitRefused(refusal);
  }
  return trimmed;
}

/** Refuses a remote operation that names no remote, before Git is reached. */
function requireRemote(remote: string): string {
  const name = remote.trim();
  if (!name) {
    throw new GitRefused(
      "Choose a remote first. Add one on the Branches tab if this repository has none.",
    );
  }
  return name;
}

function requireBranch(branch: string): string {
  const name = branch.trim();
  if (!name) {
    throw new GitRefused(
      "This repository has no current branch, so there is nothing to pull or push.",
    );
  }
  return name;
}

function describeClone(
  branch: string | null,
  upstream: string | null,
): string | null {
  if (!branch) {
    return null;
  }
  return upstream
    ? `Checked out ${branch}, tracking ${upstream}.`
    : `Checked out ${branch}.`;
}

/**
 * Reduces Git's error output to one short line. Only Git's own diagnostics are
 * shown, never file or commit content. The cut counts whole characters, so a
 * translated diagnostic is never split through the middle of one.
 */
function firstLine(value: string): string {
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return "";
  }
  const characters = Array.from(line);
  return characters.length > MAX_REPORTED_ERROR_LENGTH
    ? `${characters.slice(0, MAX_REPORTED_ERROR_LENGTH).join("")}…`
    : line;
}

function describe(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The operation could not be completed.";
}

/**
 * Names the Git operation a failure came from, when the failure knows one.
 * Anything else is attributed to the step the caller was running.
 */
function operationOf(error: unknown): string | null {
  return error instanceof GitFailure || error instanceof GitPreservedWork
    ? error.operation
    : null;
}

/**
 * Describes what stopped a step that ran after work had already been moved
 * somewhere safe.
 *
 * Every kind of failure gets a sentence of its own, because each one leaves the
 * repository in a different place: a cancelled checkout may not have started, a
 * scope change means Denote stopped looking at that repository, and a refusal
 * never reached Git at all.
 */
function describePreserved(error: unknown): string {
  if (error instanceof GitCancelled) {
    return "The branch switch was cancelled before it finished.";
  }
  if (error instanceof StaleScope) {
    return "Denote stopped the branch switch because the open repository changed.";
  }
  if (error instanceof GitFailure) {
    return `${error.message} ${error.detail}`.trim();
  }
  return describe(error);
}
