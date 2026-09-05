import type {
  PluginGitCapability,
  PluginGitConflictStage,
  PluginGitResult,
  PluginGitRunRequest,
  PluginSourceControlAction,
  PluginSourceControlAdvancedOperation,
  PluginSourceControlBranchChoice,
  PluginSourceControlCommitDetail,
  PluginSourceControlConflictDetail,
  PluginSourceControlConflictSide,
  PluginSourceControlDiffFile,
  PluginSourceControlHistoryEntry,
  PluginSourceControlHistoryPage,
  PluginSourceControlOperationPlan,
  PluginSourceControlOperationProgress,
  PluginSourceControlOperationReview,
  PluginSourceControlPendingBranchSwitch,
  PluginSourceControlPendingOperation,
  PluginSourceControlRemoteAccess,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import {
  conflictSideLabels,
  initialModel,
  initialRemoteAccess,
  initialScope,
  refreshedModel,
  scopeFor,
  selectionOf,
  uninitializedModel,
  withBusy,
  withCommitDetail,
  withConflictDetail,
  withDiffFiles,
  withHistoryPage,
  withHistoryStatus,
  withOperationPlan,
  withPendingBranchSwitch,
  withRecovery,
  withRemoteAccess,
  withReview,
  withSelection,
  withoutCommitDetail,
  withoutConflictDetail,
  HISTORY_PAGE_SIZE,
  UNREFRESHED_LABEL,
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
  type GitOperationState,
} from "./repositoryOutput";
import { DiffTooLarge, hunkRequest, parseUnifiedDiff, supportsHunkStaging } from "./diffOutput";
import { parseStatus } from "./statusOutput";
import { parseUnmergedPaths, type GitUnmergedPath } from "./conflictOutput";
import {
  ConflictContentTooLarge,
  decodeConflictStage,
  encodeResolvedContent,
} from "./conflictContent";
import {
  MergeTooLarge,
  mergeResultText,
  threeWayMerge,
  unresolvedChunkIds,
  type MergeChoices,
  type MergeResult,
  type MergeSide,
} from "./threeWayMerge";
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

/** How many paths one prepared operation lists before it says there are more. */
const MAX_PLAN_PATHS = 25;

/**
 * Why an encrypted conflict has no line content. Git records ciphertext, and
 * the managed attributes stop it line-merging or writing markers into it, so
 * the only honest resolution is choosing one recorded side whole.
 */
const ENCRYPTED_CONFLICT_LIMITATION =
  "This vault is encrypted, so Git recorded ciphertext for this file and never line-merges it. Choose the whole side you want to keep; Denote never writes plaintext into an encrypted repository.";

/** Why a binary conflict has no line content. */
const BINARY_CONFLICT_LIMITATION =
  "Git recorded this file as binary content, so it has no lines to merge. Choose the whole side you want to keep.";

/**
 * A checkout, or an advanced operation, that Denote prepared but did not run,
 * and everything needed to run it once the user says what should happen to the
 * working tree.
 */
interface PendingBranchSwitch {
  operation: PluginSourceControlPendingOperation;
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
 * One advanced operation that has been reviewed and not started.
 *
 * A review describes one comparison, read from one commit on one branch, so it
 * records both. Anything that moves either makes the files it listed describe
 * a repository that no longer exists, and the review stops being something
 * Denote will run.
 */
interface PreparedOperation {
  plan: PluginSourceControlOperationPlan;
  request: PluginGitRunRequest;
  busyMessage: string;
  /** The branch the review was prepared on, or null for a detached HEAD. */
  branch: string | null;
  /** The commit that branch pointed at when the review was prepared. */
  head: string | null;
}

/**
 * The conflicted path a surface has open.
 *
 * Every side comes from the index, never from the working tree copy: that copy
 * holds Git's markers, and a note may legitimately contain the same
 * characters. `dirty` is what makes leaving the editor ask rather than discard.
 */
interface ConflictEditor {
  path: string;
  operation: PluginSourceControlAdvancedOperation | null;
  encrypted: boolean;
  binary: boolean;
  sides: Record<MergeSide, PluginSourceControlConflictSide>;
  merge: MergeResult | null;
  choices: MergeChoices;
  result: string | null;
  /** True once the result stopped being the merge Denote derived. */
  manual: boolean;
  /** True while the result has not been written back to the repository. */
  dirty: boolean;
  limitation: string | null;
  status: string | null;
  error: string | null;
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
  /** The advanced operation that has been reviewed and not started. */
  private prepared: PreparedOperation | null = null;
  /** The conflicted path the surface has open, with every side it read. */
  private conflict: ConflictEditor | null = null;
  /**
   * Identifies the conflict read the model is allowed to accept. Opening
   * another path, closing the editor, or changing scope moves it, so a read
   * that lands late is dropped instead of publishing one path's content under
   * another path's name.
   */
  private conflictToken = 0;
  private readonly repositorySnapshots = new Map<
    string,
    {
      initialized: boolean;
      branch: string | null;
      changes: number;
    }
  >();

  constructor(
    scope: GitRepositoryScope,
    private readonly options: GitControllerOptions,
    private repositories: GitRepositoryScope[] = [scope],
    remoteAccess: PluginSourceControlRemoteAccess = initialRemoteAccess(),
  ) {
    this.scope = scope;
    this.current = initialModel(scope, remoteAccess, repositories);
    this.stable = this.current;
    for (const repository of repositories) {
      this.repositorySnapshots.set(repository.repositoryId, {
        initialized: repository.detected === true,
        branch: null,
        changes: 0,
      });
    }
    this.rememberRepository(this.current);
  }

  get model(): PluginSourceControlViewModel {
    return this.current;
  }

  get repositoryId(): string {
    return this.scope.repositoryId;
  }

  setRepositories(
    repositories: GitRepositoryScope[],
    currentProject: Parameters<typeof scopeFor>[0],
    workspaceChanged: boolean,
  ): void {
    const available =
      repositories.length > 0 ? repositories : [scopeFor(currentProject)];
    const selected =
      (!workspaceChanged &&
        available.find(
          (repository) => repository.repositoryId === this.scope.repositoryId,
        )) ||
      initialScope(currentProject, available);
    const repositoriesChanged =
      available.length !== this.repositories.length ||
      available.some((repository, index) => {
        const previous = this.repositories[index];
        return (
          previous?.repositoryId !== repository.repositoryId ||
          previous.projectId !== repository.projectId ||
          previous.name !== repository.name
        );
      });
    this.repositories = available;
    if (
      workspaceChanged ||
      selected.repositoryId !== this.scope.repositoryId
    ) {
      this.setScope(selected, workspaceChanged);
      return;
    }
    if (!repositoriesChanged) {
      return;
    }
    this.scope = selected;
    this.publish(this.current);
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
    // An unsaved resolution cannot follow the user to another repository, so
    // it is reported rather than dropped silently.
    const abandoned = this.conflict?.dirty ? this.conflict.path : null;
    this.scope = scope;
    this.generation += 1;
    this.busy = false;
    this.currentOperationId = null;
    this.encrypted = false;
    this.openDiff = null;
    this.historyPageIndex = 0;
    this.historyToken += 1;
    this.pendingSwitch = null;
    this.prepared = null;
    this.conflict = null;
    this.conflictToken += 1;
    // Remote and clone state describes how the user signs in and what a failed
    // clone left behind. Neither belongs to the repository that was open, so
    // both survive a scope change while everything read from Git is discarded.
    this.current = initialModel(scope, this.remoteAccess, this.repositories);
    this.stable = this.current;
    if (abandoned) {
      this.options.report("Closed a conflict editor with an unsaved result.");
      this.current = withReview(this.current, {
        operation: "Conflict",
        outcome: "cancelled",
        summary: `The resolution you were editing for ${abandoned} was not saved, because Denote is now looking at a different repository.`,
        detail: null,
      });
      this.stable = this.current;
    }
    this.publish(this.current);
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
        if (this.refusesForUnsavedConflict("move to another tab")) {
          return;
        }
        this.leaveConflict();
        this.selectTab(text(action, "tab"));
        return;
      case "open-commit":
        if (this.refusesForUnsavedConflict("open that commit")) {
          return;
        }
        this.leaveConflict();
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
      case "select-workspace-repository":
        if (this.refusesForUnsavedConflict("open another repository")) {
          return;
        }
        await this.selectWorkspaceRepository(
          text(action, "repositoryId"),
          git,
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
          await this.refreshWorkingTree(capability, generation);
        });
        return;
      }
      case "stage-all":
      case "unstage-all": {
        const operation = action.id === "stage-all" ? "stage" : "unstage";
        const kinds =
          operation === "stage"
            ? (["unstaged", "untracked"] as const)
            : (["staged"] as const);
        const paths = kinds.flatMap((kind) => pathsIn(this.current, kind));
        if (paths.length === 0) {
          this.publishFailure(
            new GitRefused(
              operation === "stage"
                ? "There are no eligible changes to stage."
                : "There are no staged changes to unstage.",
            ),
          );
          return;
        }
        await this.withOperation(git, async (capability, generation) => {
          await this.perform(
            capability,
            generation,
            operation === "stage"
              ? "Staging all changes"
              : "Unstaging all changes",
            { operation, scope: this.scope.kind, paths },
          );
          await this.refreshWorkingTree(capability, generation);
        });
        return;
      }
      case "restore-from-upstream":
      case "restore-all-from-upstream": {
        const restoreAll = action.id === "restore-all-from-upstream";
        const path = text(action, "path");
        const paths = restoreAll
          ? [
              ...new Set(
                (["staged", "unstaged"] as const).flatMap((kind) =>
                  pathsIn(this.current, kind),
                ),
              ),
            ]
          : path
            ? [path]
            : [];
        if (paths.length === 0) {
          this.publishFailure(
            new GitRefused(
              restoreAll
                ? "There are no tracked changes to restore."
                : "Choose a tracked file to restore first.",
            ),
          );
          return;
        }
        if (!this.current.repository.upstream) {
          this.publishFailure(
            new GitRefused(
              "This branch has no upstream, so there is no current remote branch to restore from.",
            ),
          );
          return;
        }
        if (
          !restoreAll &&
          !(["staged", "unstaged"] as const).some((kind) =>
            pathsIn(this.current, kind).includes(path),
          )
        ) {
          this.publishFailure(
            new GitRefused(
              "Only tracked staged or unstaged files can be restored from the current remote branch.",
            ),
          );
          return;
        }
        await this.withOperation(git, async (capability, generation) => {
          await this.perform(
            capability,
            generation,
            `Restoring ${restoreAll ? "tracked changes" : path} from ${this.current.repository.upstream}`,
            {
              operation: "restore-from-upstream",
              scope: this.scope.kind,
              paths,
            },
          );
          await this.refreshWorkingTree(capability, generation);
          this.reviewed(
            "Restore from remote",
            "succeeded",
            `${
              restoreAll
                ? `${paths.length} tracked file${paths.length === 1 ? "" : "s"} now match`
                : `${path} now matches`
            } ${this.current.repository.upstream}.`,
          );
        });
        return;
      }
      case "commit":
        await this.withOperation(git, (capability, generation) =>
          this.commit(
            capability,
            generation,
            text(action, "message"),
          ),
        );
        return;
      case "commit-and-push":
        await this.withOperation(git, (capability, generation) =>
          this.commitAndPush(
            capability,
            generation,
            text(action, "message"),
            text(action, "remote"),
            text(action, "branch"),
          ),
        );
        return;
      case "open-diff":
        if (this.refusesForUnsavedConflict("open that diff")) {
          return;
        }
        this.leaveConflict();
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
      case "rename-remote-branch":
        await this.withOperation(git, (capability, generation) =>
          this.renameRemoteBranch(
            capability,
            generation,
            text(action, "name"),
            text(action, "newName"),
          ),
        );
        return;
      case "delete-remote-branch":
        await this.withOperation(git, (capability, generation) =>
          this.deleteRemoteBranch(
            capability,
            generation,
            text(action, "name"),
          ),
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
      case "prepare-merge":
      case "prepare-rebase":
      case "prepare-cherry-pick":
      case "prepare-revert": {
        const operation = advancedOperationOf(action.id.slice("prepare-".length));
        if (!operation) {
          this.reportUnsupported(action.id);
          return;
        }
        await this.withOperation(git, (capability, generation) =>
          this.prepareOperation(
            capability,
            generation,
            operation,
            operationSource(action, operation),
          ),
        );
        return;
      }
      case "cancel-operation-plan":
        if (!this.busy) {
          // Cancelling the review also cancels any commit-or-stash request
          // that was waiting to run it. Leaving that request behind would keep
          // controls on screen that still start the operation the user has
          // just said no to.
          this.discardPreparedOperation();
          this.publish(
            withPendingBranchSwitch(
              withOperationPlan(this.stable, null),
              this.pendingSwitch
                ? this.describePending(this.pendingSwitch)
                : null,
            ),
          );
        }
        return;
      case "merge":
      case "rebase":
      case "cherry-pick":
      case "revert": {
        const operation = advancedOperationOf(action.id);
        if (!operation) {
          this.reportUnsupported(action.id);
          return;
        }
        await this.withOperation(git, (capability, generation) =>
          this.startOperation(
            capability,
            generation,
            operation,
            operationSource(action, operation),
          ),
        );
        return;
      }
      case "continue":
      case "skip":
      case "abort": {
        const step = action.id;
        await this.withOperation(git, (capability, generation) =>
          this.resumeOperation(
            capability,
            generation,
            step,
            text(action, "sequencer"),
          ),
        );
        return;
      }
      case "open-conflict":
        // Re-reading the sides rebuilds the merge from scratch, so an unsaved
        // result is refused here exactly as it is when leaving the editor: a
        // re-open is not a way to lose work quietly.
        if (this.refusesForUnsavedConflict("open that conflict")) {
          return;
        }
        await this.withOperation(git, (capability, generation) =>
          this.openConflict(capability, generation, text(action, "path")),
        );
        return;
      case "close-conflict":
        if (this.busy || this.refusesForUnsavedConflict("close the conflict")) {
          return;
        }
        this.leaveConflict();
        this.publish(withoutConflictDetail(this.stable));
        return;
      case "choose-conflict-change":
        this.chooseConflictChange(
          text(action, "chunkId"),
          text(action, "side"),
        );
        return;
      case "use-conflict-side":
        this.useConflictSide(text(action, "side"));
        return;
      case "edit-conflict-result":
        this.editConflictResult(text(action, "result"));
        return;
      case "discard-conflict-result":
        this.discardConflictResult();
        return;
      case "resolve-conflict":
        await this.withOperation(git, (capability, generation) =>
          this.resolveConflictContent(capability, generation),
        );
        return;
      case "resolve-conflict-stage":
        await this.withOperation(git, (capability, generation) =>
          this.resolveConflictSide(capability, generation, text(action, "side")),
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

  private async selectWorkspaceRepository(
    repositoryId: string,
    git: PluginGitCapability | undefined,
  ): Promise<void> {
    const scope = this.repositories.find(
      (repository) => repository.repositoryId === repositoryId,
    );
    if (!scope) {
      this.publishFailure(
        new GitRefused(
          "That repository is no longer available in this vault. Refresh the workspace and try again.",
        ),
      );
      return;
    }
    this.setScope(scope);
    await this.withOperation(git, (capability, generation) =>
      this.refresh(capability, generation),
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
      this.prepared = null;
      this.conflict = null;
      this.conflictToken += 1;
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
    const report = parseStatus(status.stdout);
    const operationState = parseOperationState(state.stdout);
    // Nothing here starts an operation: the repository is only ever asked what
    // it is already doing, and the controls that are valid for it are
    // published for the user to choose from.
    const operationProgress = operationProgressOf(
      operationState,
      report.conflicted.map((resource) => resource.path),
    );
    const notice = this.reconcileConflictEditor(report, operationProgress);
    // A review is only still a review while it describes what this refresh
    // just read, so it is revalidated here rather than republished blindly.
    const operationPlan = this.reviewedPlan(
      report.branch,
      entries[0]?.id ?? null,
    );
    this.publish(
      refreshedModel(this.scope, selectionOf(this.current), {
        status: report,
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
        conflictDetail: this.conflict ? detailOf(this.conflict, false) : null,
        operationProgress,
        operationPlan,
        recovery: interruptedOperation(operationState, operationProgress),
        remoteAccess: this.remoteAccess,
        pendingBranchSwitch: this.pendingSwitch
          ? this.current.pendingBranchSwitch
          : null,
      }),
    );
    if (notice) {
      this.publish(
        withReview(this.current, {
          operation: "Conflict",
          outcome: "cancelled",
          summary: notice,
          detail: null,
        }),
      );
    }
  }

  private async refreshWorkingTree(
    git: PluginGitCapability,
    generation: number,
  ): Promise<void> {
    const status = await this.perform(
      git,
      generation,
      "Reading the working tree",
      { operation: "status", scope: this.scope.kind },
    );
    const state = await this.perform(
      git,
      generation,
      "Reading the operation state",
      { operation: "operation-state", scope: this.scope.kind },
    );
    const diffFiles = await this.readOpenDiff(git, generation);
    const report = parseStatus(status.stdout);
    const operationState = parseOperationState(state.stdout);
    const operationProgress = operationProgressOf(
      operationState,
      report.conflicted.map((resource) => resource.path),
    );
    const notice = this.reconcileConflictEditor(report, operationProgress);
    const operationPlan = this.reviewedPlan(
      report.branch,
      this.current.history[0]?.id ?? null,
    );
    this.publish(
      refreshedModel(this.scope, selectionOf(this.current), {
        status: report,
        branches: this.current.branches,
        remotes: this.current.remotes,
        history: this.current.history,
        historyPage: this.current.historyPage,
        commitDetail: preservedCommitDetail(
          this.current,
          this.current.history,
        ),
        diffFiles,
        diffSource: this.openDiff ? { kind: this.openDiff.target } : null,
        conflictDetail: this.conflict ? detailOf(this.conflict, false) : null,
        operationProgress,
        operationPlan,
        recovery: interruptedOperation(operationState, operationProgress),
        remoteAccess: this.remoteAccess,
        pendingBranchSwitch: this.pendingSwitch
          ? this.current.pendingBranchSwitch
          : null,
      }),
    );
    if (notice) {
      this.publish(
        withReview(this.current, {
          operation: "Conflict",
          outcome: "cancelled",
          summary: notice,
          detail: null,
        }),
      );
    }
  }

  /**
   * Keeps the conflict editor only while Git still reports that exact path as
   * unmerged.
   *
   * A path that has been resolved, or that has left the working tree
   * altogether, closes the editor and is reported rather than left on screen
   * describing a conflict the repository no longer has. An unsaved result is
   * named explicitly, so nothing is ever discarded quietly.
   */
  private reconcileConflictEditor(
    report: ReturnType<typeof parseStatus>,
    progress: PluginSourceControlOperationProgress | null,
  ): string | null {
    const editor = this.conflict;
    if (!editor) {
      return null;
    }
    if (report.conflicted.some((resource) => resource.path === editor.path)) {
      editor.operation = progress?.operation ?? editor.operation;
      return null;
    }
    const unsaved = editor.dirty;
    this.conflict = null;
    this.conflictToken += 1;
    this.options.report("Closed a conflict editor for a path that is no longer conflicted.");
    return unsaved
      ? `Denote closed the conflict editor for ${editor.path}, because Git no longer reports it as conflicted. The result you were editing was not written.`
      : `Denote closed the conflict editor for ${editor.path}, because Git no longer reports it as conflicted.`;
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
    await this.refreshWorkingTree(git, generation);
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
    const request: PluginGitRunRequest = {
      operation: "commit",
      scope: this.scope.kind,
      message: trimmed,
      ...(settings.identity
        ? {
            authorName: settings.identity.authorName,
            authorEmail: settings.identity.authorEmail,
          }
        : {}),
    };
    await this.perform(git, generation, "Committing staged changes", request);
    this.options.report("Committed staged changes.", {
      identity: settings.identity ? "configured" : "repository",
    });
    await this.refresh(git, generation);
  }

  private async commitAndPush(
    git: PluginGitCapability,
    generation: number,
    message: string,
    remote: string,
    branch: string,
  ): Promise<void> {
    const name = requireRemote(remote);
    const target = requireBranch(branch);
    const trimmed = message.trim();
    if (!trimmed) {
      throw new GitRefused("A commit needs a message.");
    }
    const staged =
      this.current.resourceGroups.find((group) => group.kind === "staged")
        ?.resources.length ?? 0;
    if (staged === 0) {
      throw new GitRefused(
        "Stage at least one change before committing and pushing.",
      );
    }
    const settings = readGitSettings(await this.options.readSettings());
    let committed = false;
    try {
      await this.perform(git, generation, "Committing staged changes", {
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
      committed = true;
      await this.perform(git, generation, `Pushing ${target} to ${name}`, {
        operation: "push",
        scope: this.scope.kind,
        remote: name,
        branch: target,
        setUpstream: this.current.repository.upstream === null,
        mode: "normal",
        authMode: settings.authMode,
      });
    } finally {
      if (committed && generation === this.generation) {
        await this.refresh(git, generation);
      }
    }
    this.reviewed(
      "Commit and push",
      "succeeded",
      `Committed staged changes and pushed ${target} to ${name}.`,
    );
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

  private async renameRemoteBranch(
      git: PluginGitCapability,
      generation: number,
      name: string,
      newName: string,
    ): Promise<void> {
      const branch = this.requireRemoteBranch(name);
      const renamed = requireBranchName(newName, "A rename needs a new name.");
      if (branch.name === renamed) {
        throw new GitRefused(`${name} already has that name.`);
      }
      const authMode = await this.authMode();
      try {
        await this.perform(git, generation, `Renaming ${name}`, {
          operation: "rename-remote-branch",
          scope: this.scope.kind,
          remote: branch.remote,
          name: branch.name,
          newName: renamed,
          authMode,
        });
      } catch (error) {
        await this.refresh(git, generation);
        throw error;
      }
      await this.refresh(git, generation);
      this.reviewed(
        "Rename remote branch",
        "succeeded",
        `${name} is now ${branch.remote}/${renamed}.`,
      );
    }

  private async deleteRemoteBranch(
      git: PluginGitCapability,
      generation: number,
      name: string,
    ): Promise<void> {
      const branch = this.requireRemoteBranch(name);
      const authMode = await this.authMode();
      await this.perform(git, generation, `Deleting ${name}`, {
        operation: "delete-remote-branch",
        scope: this.scope.kind,
        remote: branch.remote,
        name: branch.name,
        authMode,
      });
      await this.refresh(git, generation);
      this.reviewed(
        "Delete remote branch",
        "succeeded",
        `${name} was deleted from ${branch.remote}. Local branches are unchanged.`,
      );
    }

  private requireRemoteBranch(value: string): {
      remote: string;
      name: string;
    } {
      const known = this.current.branches.find(
        (branch) => branch.remote && branch.name === value,
      );
      const separator = value.indexOf("/");
      if (!known || separator <= 0 || separator === value.length - 1) {
        throw new GitRefused(
          `${value || "That branch"} is not a remote branch in this repository. Refresh and try again.`,
        );
      }
      return {
        remote: value.slice(0, separator),
        name: value.slice(separator + 1),
      };
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
      operation: "checkout",
      fromBranch: this.current.repository.branch,
      stagedPaths: staged,
      unstagedPaths: unstaged,
      untrackedPaths: untracked,
    };
    if (staged.length + unstaged.length + untracked.length === 0) {
      this.pendingSwitch = null;
      await this.runPending(git, generation, pending);
      return;
    }
    this.pendingSwitch = pending;
    this.publish(
      withPendingBranchSwitch(this.current, this.describePending(pending)),
    );
  }

  /**
   * Runs whichever operation the review was holding, once the working tree is
   * safe. A checkout and an advanced operation both replace files on disk, so
   * both come through here rather than running from two different places.
   */
  private async runPending(
    git: PluginGitCapability,
    generation: number,
    plan: PendingBranchSwitch,
  ): Promise<void> {
    if (plan.operation === "checkout") {
      await this.runCheckout(git, generation, plan);
      return;
    }
    // The answer to a commit-or-stash review only ever runs the operation that
    // is still reviewed. A review that was cancelled, or that stopped
    // describing this repository, leaves nothing here that can start one.
    const prepared = this.requirePreparedFor(plan.operation, plan.target);
    if (prepared.branch !== plan.fromBranch) {
      this.refusePreparedOperation(
        `Denote reviewed this ${plan.operation} on ${branchLabel(prepared.branch)}, but this request was made on ${branchLabel(plan.fromBranch)}. Preview the ${plan.operation} again from the branch you are on.`,
      );
    }
    await this.runAdvanced(git, generation, plan.operation, plan.target, {
      request: plan.request,
      busyMessage: plan.busyMessage,
    });
  }

  private async runCheckout(
    git: PluginGitCapability,
    generation: number,
    plan: PendingBranchSwitch,
  ): Promise<void> {
    await this.perform(git, generation, plan.busyMessage, plan.request);
    this.pendingSwitch = null;
    // A checkout replaces files on disk, so the diff that was open described a
    // branch the user has left, and any review prepared on it described a
    // comparison from a branch this repository is no longer on.
    this.discardPreparedOperation();
    this.openDiff = null;
    await this.refresh(git, generation);
    this.publish(withPendingBranchSwitch(this.current, null));
    const now = plan.localBranch ?? plan.target;
    this.reviewed("Switch branch", "succeeded", `You are now on ${now}.`);
  }

  // -------------------------------------------------------------------------
  // Advanced operations
  // -------------------------------------------------------------------------

  /**
   * Prepares one advanced operation for review, without running anything.
   *
   * The repository is read again first, so the review names the branch the
   * operation would really change, and the files it is expected to touch are
   * read from Git rather than guessed. Nothing starts here: a refresh, an
   * activation, and a restart all end at this review.
   */
  private async prepareOperation(
    git: PluginGitCapability,
    generation: number,
    operation: PluginSourceControlAdvancedOperation,
    source: string,
  ): Promise<void> {
    const chosen = source.trim();
    if (!chosen) {
      throw new GitRefused(missingSourceRefusal(operation));
    }
    await this.refresh(git, generation);
    this.requireNoOperationInProgress();
    const sourceDetail = this.describeSource(operation, chosen);
    const affected = await this.affectedPaths(git, generation, operation, chosen);
    const currentBranch = this.current.repository.branch;
    const plan: PluginSourceControlOperationPlan = {
      operation,
      source: chosen,
      sourceDetail,
      currentBranch,
      risk: riskOf(operation),
      summary: describeOperation(operation, chosen, currentBranch),
      affectedPaths: affected.paths,
      affectedPathsLimitation: affected.limitation,
      startActionId: operation,
      cancelActionId: "cancel-operation-plan",
    };
    this.prepared = {
      plan,
      request: advancedRequest(operation, chosen, this.scope.kind),
      busyMessage: busyMessageFor(operation, chosen),
      branch: currentBranch,
      head: this.current.repository.latestCommit?.id ?? null,
    };
    this.publish(withOperationPlan(this.current, plan));
  }

  /**
   * Returns the review this refresh may keep publishing, and discards one that
   * has stopped describing the repository.
   *
   * The files a review lists were read from one branch, at one commit. A
   * checkout, a pull, a commit, or a change made outside Denote moves one of
   * them, and the comparison the user reviewed no longer exists, so the review
   * is dropped along with any request that was waiting to run it.
   */
  private reviewedPlan(
    branch: string | null,
    head: string | null,
  ): PluginSourceControlOperationPlan | null {
    const prepared = this.prepared;
    if (!prepared) {
      return null;
    }
    if (prepared.branch === branch && prepared.head === head) {
      return prepared.plan;
    }
    this.discardPreparedOperation();
    return null;
  }

  /**
   * Discards a prepared review, and any commit-or-stash request waiting to run
   * it. A pending checkout is left alone: it is not started from a review, and
   * it stays valid whatever happened to the review.
   */
  private discardPreparedOperation(): void {
    this.prepared = null;
    if (this.pendingSwitch && this.pendingSwitch.operation !== "checkout") {
      this.pendingSwitch = null;
    }
  }

  /**
   * Refuses an advanced operation, and clears everything that could start it
   * again, before the refusal is published.
   *
   * Clearing first is what makes the refusal true: the surface that is left
   * offers no control that runs the operation, rather than a review the
   * provider would only refuse a second time.
   */
  private refusePreparedOperation(message: string): never {
    this.prepared = null;
    this.pendingSwitch = null;
    this.publish(
      withPendingBranchSwitch(withOperationPlan(this.stable, null), null),
    );
    throw new GitRefused(message);
  }

  /**
   * Returns the review an advanced operation must still have.
   *
   * Every path that runs one comes through here, so a request that outlived
   * its review — cancelled, spent, or invalidated by something that moved HEAD
   * — starts nothing.
   */
  private requirePreparedFor(
    operation: PluginSourceControlAdvancedOperation,
    source: string,
  ): PreparedOperation {
    const prepared = this.prepared;
    if (
      !prepared ||
      prepared.plan.operation !== operation ||
      prepared.plan.source !== source
    ) {
      this.refusePreparedOperation(
        `Denote only runs an operation you have just reviewed. Preview the ${operation} again, then start it from the review.`,
      );
    }
    return prepared;
  }

  /**
   * Refuses a review that was prepared somewhere this repository no longer is.
   *
   * The branch, and the commit it pointed at, are what the review was read
   * from. If either moved between the review and the start, the operation
   * would run from a different place than the one the user read about, so a
   * new preview is required instead.
   */
  private requireReviewedContext(
    prepared: PreparedOperation,
    operation: PluginSourceControlAdvancedOperation,
  ): void {
    const branch = this.current.repository.branch;
    const head = this.current.repository.latestCommit?.id ?? null;
    if (prepared.branch === branch && prepared.head === head) {
      return;
    }
    this.refusePreparedOperation(
      prepared.branch !== branch
        ? `Denote reviewed this ${operation} on ${branchLabel(prepared.branch)}, but this repository is now on ${branchLabel(branch)}. Preview the ${operation} again from here, and read what it would change.`
        : `${branchLabel(branch)} has moved since Denote reviewed this ${operation}, so the files it listed no longer describe what would change. Preview the ${operation} again.`,
    );
  }

  /**
   * Names the source of an operation, and refuses one Denote cannot describe.
   *
   * A merge and a rebase name a branch this repository already has, so nothing
   * has to be fetched for one to run. A cherry-pick and a revert name a commit
   * from the history page that is on screen, so the commit acted on is always
   * the one the user selected.
   */
  private describeSource(
    operation: PluginSourceControlAdvancedOperation,
    source: string,
  ): string | null {
    if (operation === "merge" || operation === "rebase") {
      const known = this.requireKnownBranch(source);
      if (known.current) {
        throw new GitRefused(
          operation === "merge"
            ? `You are already on ${source}, so there is nothing to merge in.`
            : `You are already on ${source}, so there is nothing to rebase onto.`,
        );
      }
      return known.remote
        ? "Remote-tracking branch, as your last fetch left it."
        : "Local branch.";
    }
    const entry = this.current.history.find((item) => item.id === source);
    if (!entry) {
      throw new GitRefused(
        "That commit is not in the history page Denote has read. Refresh history, select the commit, and try again.",
      );
    }
    return `${entry.shortId} · ${entry.summary}`;
  }

  /**
   * Reads the files an operation is expected to touch.
   *
   * A cherry-pick and a revert act on one commit, so its own diff is the exact
   * list. A merge and a rebase are a comparison between two branches, which is
   * a superset: the list is published with that said plainly rather than
   * presented as the change the operation will make. A comparison Denote will
   * not read is reported as unavailable instead of guessed at.
   */
  private async affectedPaths(
    git: PluginGitCapability,
    generation: number,
    operation: PluginSourceControlAdvancedOperation,
    source: string,
  ): Promise<{ paths: string[]; limitation: string | null }> {
    const branch = currentBranchName(this.current);
    const commitScoped = operation === "cherry-pick" || operation === "revert";
    let files: PluginSourceControlDiffFile[];
    try {
      const result = await this.perform(
        git,
        generation,
        `Reading what ${source} changes`,
        {
          operation: "diff",
          scope: this.scope.kind,
          target: commitScoped
            ? { kind: "commit", commit: source }
            : { kind: "range", fromCommit: branch, toCommit: source },
        },
      );
      files = parseUnifiedDiff(result.stdout);
    } catch (error) {
      if (error instanceof DiffTooLarge) {
        return { paths: [], limitation: error.message };
      }
      if (error instanceof GitFailure) {
        return {
          paths: [],
          limitation: `Denote could not read what ${source} changes, so no files are listed here. ${error.detail}`.trim(),
        };
      }
      throw error;
    }
    const paths = files.map((file) => file.path);
    const shown = paths.slice(0, MAX_PLAN_PATHS);
    const hidden = paths.length - shown.length;
    const overflow =
      hidden > 0 ? ` ${hidden} more file${hidden === 1 ? "" : "s"} not listed.` : "";
    if (commitScoped) {
      return {
        paths: shown,
        limitation: overflow ? overflow.trim() : null,
      };
    }
    return {
      paths: shown,
      limitation:
        `These are the files that differ between ${branch} and ${source}. A ${operation} may not change all of them.${overflow}`.trim(),
    };
  }

  /**
   * Starts the operation the user has just reviewed.
   *
   * The review is the authority: an operation that does not match one is
   * refused, so nothing can start from a stale surface. The repository is read
   * again first, and work in the working tree goes through the same
   * commit-or-stash review a checkout uses rather than being run over.
   */
  private async startOperation(
    git: PluginGitCapability,
    generation: number,
    operation: PluginSourceControlAdvancedOperation,
    source: string,
  ): Promise<void> {
    const chosen = source.trim();
    const prepared = this.requirePreparedFor(operation, chosen);
    await this.refresh(git, generation);
    // The refresh may have read a repository that has moved since the review,
    // so what it read decides whether the review may still be started.
    this.requireReviewedContext(prepared, operation);
    this.requireNoOperationInProgress();
    if (this.current.conflicts.length > 0) {
      throw new GitRefused(
        `This repository has unresolved conflicts, so Denote will not start a ${operation}. Resolve them, then continue or abort the operation that is already running.`,
      );
    }
    const staged = pathsIn(this.current, "staged");
    const unstaged = pathsIn(this.current, "unstaged");
    const untracked = pathsIn(this.current, "untracked");
    const pending: PendingBranchSwitch = {
      operation,
      request: prepared.request,
      busyMessage: prepared.busyMessage,
      target: chosen,
      localBranch: null,
      fromBranch: this.current.repository.branch,
      stagedPaths: staged,
      unstagedPaths: unstaged,
      untrackedPaths: untracked,
    };
    if (staged.length + unstaged.length + untracked.length === 0) {
      this.pendingSwitch = null;
      await this.runPending(git, generation, pending);
      return;
    }
    // The working tree holds work this operation could alter, so it is
    // reviewed exactly like a checkout: commit it, stash it, or cancel.
    this.pendingSwitch = pending;
    this.publish(
      withPendingBranchSwitch(this.current, this.describePending(pending)),
    );
  }

  /**
   * Runs one advanced operation and reports what it left behind.
   *
   * A merge, rebase, cherry-pick, or revert that stops on conflicts is not a
   * failure: it is exactly what Git does, and the state it left is read back
   * and published with the controls that can finish it.
   */
  private async runAdvanced(
    git: PluginGitCapability,
    generation: number,
    operation: PluginSourceControlAdvancedOperation,
    source: string,
    step: { request: PluginGitRunRequest; busyMessage: string },
  ): Promise<void> {
    // Belt to the braces of every caller: nothing runs an advanced operation
    // that no longer has a review behind it.
    this.requirePreparedFor(operation, source);
    // The review is spent the moment Git starts. Whatever the run leaves
    // behind, HEAD may have moved, so nothing may be started from it again,
    // and the surface stops offering it before the run rather than after.
    this.prepared = null;
    this.pendingSwitch = null;
    this.publish(
      withPendingBranchSwitch(withOperationPlan(this.current, null), null),
    );
    const result = await this.perform(
      git,
      generation,
      step.busyMessage,
      step.request,
      true,
    );
    // The worktree has been rewritten, so nothing read from the previous one
    // stays on screen.
    this.openDiff = null;
    this.leaveConflict();
    await this.refresh(git, generation);
    this.publish(
      withPendingBranchSwitch(withOperationPlan(this.current, null), null),
    );
    const label = operationLabel(operation);
    if (result.exitCode === 0) {
      this.reviewed(label, "succeeded", succeededSummary(operation, source));
      return;
    }
    const conflicts = this.current.conflicts.length;
    if (conflicts > 0 || this.current.operationProgress) {
      this.options.report("A Git operation stopped for conflict resolution.", {
        operation,
      });
      this.reviewed(
        label,
        "failed",
        stoppedSummary(operation, source, conflicts),
        firstLine(result.stderr) || null,
      );
      return;
    }
    throw new GitFailure(
      step.request.operation,
      result.exitCode,
      firstLine(result.stderr),
    );
  }

  /**
   * Continues, skips, or aborts the operation Git reports is in progress.
   *
   * The repository's own state decides what may run: the action names the
   * operation it was rendered for, and a name that no longer matches is
   * refused rather than applied to whatever is running now.
   */
  private async resumeOperation(
    git: PluginGitCapability,
    generation: number,
    step: "continue" | "skip" | "abort",
    sequencer: string,
  ): Promise<void> {
    const progress = this.current.operationProgress;
    if (!progress) {
      throw new GitRefused(
        "Denote does not see a merge, rebase, cherry-pick, or revert in progress. Refresh to read this repository again.",
      );
    }
    const named = advancedOperationOf(sequencer);
    if (named && named !== progress.operation) {
      throw new GitRefused(
        `This repository is running a ${progress.operation}, not a ${named}. Refresh to read it again.`,
      );
    }
    if (step === "continue" && !progress.continueAvailable) {
      throw new GitRefused(
        progress.continueUnavailableReason ??
          `Denote cannot continue this ${progress.operation} yet.`,
      );
    }
    if (step === "skip" && !progress.skipAvailable) {
      throw new GitRefused(
        `A ${progress.operation} cannot be skipped. Continue it once every conflict is resolved, or abort it.`,
      );
    }
    const operation = progress.operation;
    const request: PluginGitRunRequest = {
      operation: step,
      scope: this.scope.kind,
      sequencer: operation,
    };
    const result = await this.perform(
      git,
      generation,
      `${step === "continue" ? "Continuing" : step === "skip" ? "Skipping a step of" : "Aborting"} the ${operation}`,
      request,
      true,
    );
    // Continuing, skipping, and aborting all move HEAD or rewrite the
    // worktree, so nothing prepared against the previous one survives.
    this.discardPreparedOperation();
    this.openDiff = null;
    this.leaveConflict();
    await this.refresh(git, generation);
    const label = `${step === "continue" ? "Continue" : step === "skip" ? "Skip" : "Abort"} ${operation}`;
    if (result.exitCode === 0) {
      this.reviewed(label, "succeeded", resumedSummary(step, operation, this.current));
      return;
    }
    const conflicts = this.current.conflicts.length;
    if (conflicts > 0 || this.current.operationProgress) {
      this.reviewed(
        label,
        "failed",
        stoppedSummary(operation, operation, conflicts),
        firstLine(result.stderr) || null,
      );
      return;
    }
    throw new GitFailure(step, result.exitCode, firstLine(result.stderr));
  }

  private requireNoOperationInProgress(): void {
    const progress = this.current.operationProgress;
    if (!progress) {
      return;
    }
    throw new GitRefused(
      `This repository already has a ${progress.operation} in progress. Continue or abort it before starting another operation.`,
    );
  }

  // -------------------------------------------------------------------------
  // Conflict resolution
  // -------------------------------------------------------------------------

  /**
   * Opens one conflicted path.
   *
   * The index is asked first whether that exact path is still unmerged, and
   * which sides it holds, so a surface that has fallen behind can never open a
   * conflict that no longer exists. Each recorded side is then read through
   * the typed stage read and decoded strictly; anything that is not bounded
   * UTF-8 text is treated as content Denote must not display.
   */
  private async openConflict(
    git: PluginGitCapability,
    generation: number,
    path: string,
  ): Promise<void> {
    const target = path.trim();
    if (!target) {
      throw new GitRefused("No file path was supplied for this action.");
    }
    const unmerged = await this.readUnmergedPath(git, generation, target);
    const token = ++this.conflictToken;
    const operation = this.current.operationProgress?.operation ?? null;
    const labels = conflictSideLabels(this.current.repository.branch, operation);
    const editor: ConflictEditor = {
      path: target,
      operation,
      encrypted: this.encrypted,
      binary: false,
      sides: {
        base: side("base", labels.base, unmerged.base),
        ours: side("ours", labels.ours, unmerged.ours),
        theirs: side("theirs", labels.theirs, unmerged.theirs),
      },
      merge: null,
      choices: {},
      result: null,
      manual: false,
      dirty: false,
      limitation: null,
      status: null,
      error: null,
    };
    this.publish(withConflictDetail(this.current, detailOf(editor, true)));
    // An encrypted vault records ciphertext, so no side of it is ever decoded
    // or rendered: the only resolution offered is a whole recorded side.
    if (!this.encrypted) {
      await this.readConflictSides(git, generation, editor);
    } else {
      editor.limitation = ENCRYPTED_CONFLICT_LIMITATION;
    }
    if (token !== this.conflictToken || generation !== this.generation) {
      this.options.report("Discarded a stale conflict read.");
      return;
    }
    this.conflict = editor;
    this.publish(withConflictDetail(this.stable, detailOf(editor, false)));
  }

  /**
   * Reads every side the index holds and derives the three-way merge.
   *
   * A side that is not bounded UTF-8 text makes the whole conflict a
   * whole-side choice: no line of it is ever shown, and no merged text is
   * offered for content Denote could not read exactly.
   */
  private async readConflictSides(
    git: PluginGitCapability,
    generation: number,
    editor: ConflictEditor,
  ): Promise<void> {
    let unreadable = false;
    for (const stage of ["base", "ours", "theirs"] as const) {
      if (!editor.sides[stage].present) {
        continue;
      }
      const result = await this.perform(
        git,
        generation,
        `Reading the ${stage} side of ${editor.path}`,
        {
          operation: "read-conflict-stage",
          scope: this.scope.kind,
          path: editor.path,
          stage: stage as PluginGitConflictStage,
        },
        true,
      );
      if (result.exitCode !== 0) {
        // The index stopped holding this side between the listing and the
        // read, so it is reported as absent rather than shown as empty.
        editor.sides[stage] = side(stage, editor.sides[stage].label, false);
        editor.status = `Git no longer holds the ${stage} side of this conflict.`;
        continue;
      }
      try {
        const content = decodeConflictStage(result.stdout);
        if (content.kind === "binary") {
          editor.binary = true;
          editor.sides[stage] = {
            ...editor.sides[stage],
            text: null,
            byteLength: content.byteLength,
          };
          continue;
        }
        editor.sides[stage] = {
          ...editor.sides[stage],
          text: content.text,
          byteLength: content.byteLength,
        };
      } catch (error) {
        if (error instanceof ConflictContentTooLarge) {
          unreadable = true;
          editor.limitation = error.message;
          continue;
        }
        throw new GitRefused(describe(error));
      }
    }
    if (editor.binary) {
      // Not one line of a binary side is kept, whichever side it came from.
      for (const stage of ["base", "ours", "theirs"] as const) {
        editor.sides[stage] = { ...editor.sides[stage], text: null };
      }
      editor.limitation = BINARY_CONFLICT_LIMITATION;
      return;
    }
    if (unreadable) {
      return;
    }
    try {
      editor.merge = threeWayMerge(
        editor.sides.base.text,
        editor.sides.ours.text,
        editor.sides.theirs.text,
      );
      editor.result = mergeResultText(editor.merge);
    } catch (error) {
      if (error instanceof MergeTooLarge) {
        editor.merge = null;
        editor.result = null;
        editor.limitation = error.message;
        return;
      }
      throw error;
    }
  }

  /** Asks the index whether one exact path is still unmerged. */
  private async readUnmergedPath(
    git: PluginGitCapability,
    generation: number,
    path: string,
  ): Promise<GitUnmergedPath> {
    const listing = await this.perform(
      git,
      generation,
      "Reading the conflicted files",
      { operation: "list-conflicts", scope: this.scope.kind },
    );
    const entry = parseUnmergedPaths(listing.stdout).find(
      (candidate) => candidate.path === path,
    );
    if (!entry) {
      throw new GitRefused(
        `Git no longer reports ${path} as conflicted. Refresh to read this repository again.`,
      );
    }
    return entry;
  }

  private chooseConflictChange(chunkId: string, side: string): void {
    const editor = this.editableConflict();
    if (!editor) {
      return;
    }
    const merge = editor.merge;
    if (!merge) {
      this.refuseConflictEdit(
        editor.limitation ??
          "This conflict has no line content to choose between.",
      );
      return;
    }
    const chunk = merge.chunks.find(
      (candidate) => candidate.id === chunkId && candidate.kind === "conflict",
    );
    const choice = mergeSideOf(side);
    if (!chunk || !choice) {
      this.refuseConflictEdit(
        "That change is no longer part of this conflict. Open it again and retry.",
      );
      return;
    }
    if (!editor.sides[choice].present) {
      this.refuseConflictEdit(
        `Git does not hold the ${choice} side of ${editor.path}, so it cannot be chosen.`,
      );
      return;
    }
    editor.choices = { ...editor.choices, [chunk.id]: choice };
    // A per-change choice makes the result the merge again, so what is on
    // screen always matches the choices above it.
    editor.manual = false;
    editor.result = mergeResultText(merge, editor.choices);
    editor.dirty = true;
    editor.status = null;
    editor.error = null;
    this.publish(withConflictDetail(this.stable, detailOf(editor, false)));
  }

  /** Takes one whole recorded side as the result, without writing anything. */
  private useConflictSide(side: string): void {
    const editor = this.editableConflict();
    if (!editor) {
      return;
    }
    const choice = mergeSideOf(side);
    if (!choice || !editor.sides[choice].present) {
      this.refuseConflictEdit(
        "Git does not hold that side of this conflict, so it cannot be chosen.",
      );
      return;
    }
    const text = editor.sides[choice].text;
    if (editor.merge === null || text === null) {
      this.refuseConflictEdit(
        editor.limitation ??
          "This conflict has no readable text, so use the whole-file controls to stage one recorded side.",
      );
      return;
    }
    editor.result = text;
    editor.choices = Object.fromEntries(
      editor.merge.chunks
        .filter((chunk) => chunk.kind === "conflict")
        .map((chunk) => [chunk.id, choice]),
    );
    editor.manual = true;
    editor.dirty = true;
    editor.status = `The result is ${editor.sides[choice].label}, exactly as Git recorded it.`;
    editor.error = null;
    this.publish(withConflictDetail(this.stable, detailOf(editor, false)));
  }

  private editConflictResult(result: string): void {
    const editor = this.editableConflict();
    if (!editor) {
      return;
    }
    if (editor.merge === null) {
      this.refuseConflictEdit(
        editor.limitation ??
          "This conflict has no readable text, so it cannot be edited here.",
      );
      return;
    }
    editor.result = result;
    editor.manual = true;
    editor.dirty = true;
    editor.status = "This result was edited by hand.";
    editor.error = null;
    this.publish(withConflictDetail(this.stable, detailOf(editor, false)));
  }

  /** Drops an unsaved result and returns to the merge Denote derived. */
  private discardConflictResult(): void {
    const editor = this.editableConflict();
    if (!editor) {
      return;
    }
    editor.choices = {};
    editor.manual = false;
    editor.result = editor.merge ? mergeResultText(editor.merge) : null;
    editor.dirty = false;
    editor.status = "Denote restored the merge it derived from the three sides.";
    editor.error = null;
    this.publish(withConflictDetail(this.stable, detailOf(editor, false)));
  }

  /**
   * Writes the merged result and stages it.
   *
   * Only text Denote read exactly can be written: an encrypted or binary
   * conflict has no plaintext result to send, and a merge with an unanswered
   * change is refused rather than written with that change silently dropped.
   */
  private async resolveConflictContent(
    git: PluginGitCapability,
    generation: number,
  ): Promise<void> {
    const editor = this.requireConflictEditor();
    if (editor.encrypted) {
      throw new GitRefused(ENCRYPTED_CONFLICT_LIMITATION);
    }
    if (editor.binary || editor.merge === null || editor.result === null) {
      throw new GitRefused(
        editor.limitation ?? BINARY_CONFLICT_LIMITATION,
      );
    }
    const unresolved = unresolvedChunkIds(editor.merge, editor.choices).length;
    if (!editor.manual && unresolved > 0) {
      throw new GitRefused(
        `${unresolved} change${unresolved === 1 ? "" : "s"} in ${editor.path} still need${unresolved === 1 ? "s" : ""} a side. Choose base, ours, or theirs for each one, or edit the result yourself.`,
      );
    }
    let contentBase64: string;
    try {
      contentBase64 = encodeResolvedContent(editor.result);
    } catch (error) {
      throw new GitRefused(describe(error));
    }
    await this.perform(git, generation, `Resolving ${editor.path}`, {
      operation: "resolve-conflict",
      scope: this.scope.kind,
      path: editor.path,
      resolution: { kind: "content", contentBase64 },
    });
    await this.finishResolution(git, generation, editor.path, "the merged result");
  }

  /** Stages one whole recorded side, exactly as Git holds it. */
  private async resolveConflictSide(
    git: PluginGitCapability,
    generation: number,
    side: string,
  ): Promise<void> {
    const editor = this.requireConflictEditor();
    const choice = mergeSideOf(side);
    if (!choice || !editor.sides[choice].present) {
      throw new GitRefused(
        "Git does not hold that side of this conflict, so it cannot be staged.",
      );
    }
    await this.perform(git, generation, `Resolving ${editor.path}`, {
      operation: "resolve-conflict",
      scope: this.scope.kind,
      path: editor.path,
      resolution: { kind: "stage", stage: choice as PluginGitConflictStage },
    });
    await this.finishResolution(
      git,
      generation,
      editor.path,
      editor.sides[choice].label,
    );
  }

  /**
   * Closes the editor for a resolved path and reads the repository again.
   * Every other conflicted file stays exactly as it was: nothing is resolved
   * on the user's behalf.
   */
  private async finishResolution(
    git: PluginGitCapability,
    generation: number,
    path: string,
    what: string,
  ): Promise<void> {
    this.leaveConflict();
    await this.refresh(git, generation);
    const remaining = this.current.conflicts.length;
    this.reviewed(
      "Resolve conflict",
      "succeeded",
      `${path} is staged as ${what}.`,
      remaining > 0
        ? `${remaining} conflicted file${remaining === 1 ? "" : "s"} still need${remaining === 1 ? "s" : ""} resolving.`
        : "Every conflict is resolved. Continue the operation to finish it.",
    );
  }

  /**
   * Drops the open editor. Every caller has already established that nothing
   * unsaved is being discarded, so this only forgets what is on screen.
   */
  private leaveConflict(): void {
    if (!this.conflict) {
      return;
    }
    this.conflict = null;
    this.conflictToken += 1;
  }

  private requireConflictEditor(): ConflictEditor {
    if (!this.conflict) {
      throw new GitRefused(
        "No conflict is open. Open one from the Conflicts list and try again.",
      );
    }
    return this.conflict;
  }

  /** The open editor, or nothing while Git is running or none is open. */
  private editableConflict(): ConflictEditor | null {
    if (this.busy) {
      this.options.report("Ignored a conflict edit while Git was running.");
      return null;
    }
    if (!this.conflict) {
      this.refuseConflictEdit(
        "No conflict is open. Open one from the Conflicts list and try again.",
      );
      return null;
    }
    return this.conflict;
  }

  private refuseConflictEdit(message: string): void {
    this.publish(
      withRecovery(this.stable, {
        state: "failed",
        operationId: "conflict-edit-refused",
        message,
        dismissActionId: "dismiss",
      }),
    );
  }

  /**
   * Refuses to leave a conflict editor that holds work nobody has saved.
   *
   * The action is cancelled and said so, rather than silently discarding a
   * resolution the user typed or chose. Discarding it is its own explicit
   * action.
   */
  private refusesForUnsavedConflict(intent: string): boolean {
    const editor = this.conflict;
    if (!editor?.dirty) {
      return false;
    }
    this.publish(
      withRecovery(this.stable, {
        state: "failed",
        operationId: "conflict-unsaved",
        message: `Denote did not ${intent}, because the conflict editor for ${editor.path} holds a resolution that has not been saved. Mark it resolved, or discard the result first.`,
        dismissActionId: "dismiss",
      }),
    );
    return true;
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
      await this.runPending(git, generation, plan);
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

  /**
   * Returns the request a commit or a stash is being asked to preserve work
   * for.
   *
   * An advanced operation is checked against its review here, before anything
   * is committed or stashed: work is never moved for an operation Denote has
   * already refused to run.
   */
  private requirePendingSwitch(): PendingBranchSwitch {
    if (!this.pendingSwitch) {
      throw new GitRefused(
        "There is no branch switch waiting for an answer. Start the switch again.",
      );
    }
    const pending = this.pendingSwitch;
    if (pending.operation !== "checkout") {
      this.requirePreparedFor(pending.operation, pending.target);
    }
    return pending;
  }

  private describePending(
    plan: PendingBranchSwitch,
  ): PluginSourceControlPendingBranchSwitch {
    const blockedByEncryption =
      this.encrypted && plan.untrackedPaths.length > 0;
    return {
      operation: plan.operation,
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
    // A pull moves the branch, and can rewrite the worktree, so a review
    // prepared before it no longer describes what an operation would change.
    this.discardPreparedOperation();
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
    // Nothing prepared against the repository that was open can survive a
    // different vault being opened over it.
    this.discardPreparedOperation();
    this.publish(
      withRemoteAccess(
        withPendingBranchSwitch(withOperationPlan(this.stable, null), null),
        {
          ...this.remoteAccess,
          cleanup: null,
          review: {
            operation: "Clone",
            outcome: "succeeded",
            summary: `${outcome.label} is open as a vault.`,
            detail: describeClone(outcome.branch, outcome.upstream),
          },
        },
      ),
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
    detail: string | null = null,
  ): void {
    this.publish(
      withReview(this.current, { operation, outcome, summary, detail }),
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
    /**
     * When true, a non-zero exit is returned instead of thrown. Only the
     * operations whose failure is a real repository state use it: a merge that
     * stopped on conflicts has done exactly what Git does, and the state it
     * left is read by the refresh that follows.
     */
    allowFailure = false,
  ): Promise<PluginGitResult> {
    // A scope change stops the next step of a running sequence, so no request
    // is ever issued against a repository the user already left.
    if (generation !== this.generation) {
      throw new StaleScope();
    }
    const operation = git.run(request, {
      projectId: this.scope.projectId ?? null,
    });
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
      if (result.exitCode !== 0 && !allowFailure) {
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
    this.rememberRepository(model);
    const decorated = {
      ...model,
      workspaceRepositories: this.repositories.map((repository) => {
        const snapshot = this.repositorySnapshots.get(repository.repositoryId);
        return {
          repositoryId: repository.repositoryId,
          label: repository.name,
          selected:
            repository.repositoryId === model.repository.repositoryId,
          initialized: snapshot?.initialized ?? false,
          branch: snapshot?.branch ?? null,
          changes: snapshot?.changes ?? 0,
        };
      }),
    } satisfies PluginSourceControlViewModel;
    this.current = decorated;
    // A settled model is what a failure falls back to, so a failure never
    // replaces good data with an empty repository or with progress state.
    if (!decorated.repository.busy) {
      this.stable = decorated;
    }
    this.options.publish(decorated);
  }

  private rememberRepository(model: PluginSourceControlViewModel): void {
    const previous = this.repositorySnapshots.get(
      model.repository.repositoryId,
    );
    const unrefreshed = model.repository.label.endsWith(UNREFRESHED_LABEL);
    this.repositorySnapshots.set(model.repository.repositoryId, {
      initialized: unrefreshed
        ? (previous?.initialized ?? model.repository.initialized)
        : model.repository.initialized,
      branch: model.repository.branch,
      changes: model.resourceGroups.reduce(
        (total, group) => total + group.resources.length,
        0,
      ),
    });
  }
}

/**
 * Reports a state Denote cannot resume itself.
 *
 * A merge, rebase, cherry-pick, or revert is published as progress instead,
 * with the exact controls Git allows for it, so nothing here duplicates them.
 * Anything else, such as a bisect, is reported for the user to finish with
 * their own tooling rather than offered as an action Denote does not run.
 */
function interruptedOperation(
  state: GitOperationState | null,
  progress: PluginSourceControlOperationProgress | null,
): PluginSourceControlViewModel["recovery"] {
  if (!state || progress) {
    return { state: "idle" };
  }
  const interrupted = describeOperationState(state);
  if (!interrupted) {
    return { state: "idle" };
  }
  return {
    state: "failed",
    operationId: `operation-state-${interrupted}`,
    message: `This repository has a ${interrupted} in progress. Denote does not run one, so finish it with your own Git tooling, then refresh.`,
    retryActionId: "refresh",
    dismissActionId: "dismiss",
  };
}

/**
 * Reads the host's operation-state report as the operation Git is part way
 * through, and the controls that are valid for it.
 *
 * A rebase is reported before a merge, because an interrupted rebase records a
 * merge head for the commit it is replaying and it is the rebase that has to
 * finish. Continue is offered only while Git reports no unmerged paths, and a
 * merge is never offered a skip, because Git has none.
 */
export function operationProgressOf(
  state: GitOperationState | null,
  conflictedPaths: string[],
): PluginSourceControlOperationProgress | null {
  if (!state) {
    return null;
  }
  const operation: PluginSourceControlAdvancedOperation | null =
    state.rebaseInProgress
      ? "rebase"
      : state.cherryPickInProgress
        ? "cherry-pick"
        : state.revertInProgress
          ? "revert"
          : // A sequence paused between two commits records no head file, so
            // it is named by the command the host read from its to-do list and
            // never guessed at.
            state.sequencerInProgress && state.sequencerKind
            ? state.sequencerKind
            : state.mergeInProgress
              ? "merge"
              : null;
  if (!operation) {
    return null;
  }
  const plural = conflictedPaths.length === 1 ? "" : "s";
  return {
    operation,
    summary:
      conflictedPaths.length > 0
        ? `This repository has a ${operation} in progress that stopped on ${conflictedPaths.length} conflicted file${plural}.`
        : `This repository has a ${operation} in progress.`,
    conflictedPaths,
    continueAvailable: conflictedPaths.length === 0,
    continueUnavailableReason:
      conflictedPaths.length === 0
        ? null
        : `Resolve the ${conflictedPaths.length} conflicted file${plural} first. Git refuses to continue a ${operation} while any path is unmerged.`,
    skipAvailable: operation !== "merge",
    abortAvailable: true,
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

function describeAction(actionId: string): string {
  return `run "${actionId}"`;
}

/** The typed operation one action names, or nothing for anything else. */
function advancedOperationOf(
  value: string,
): PluginSourceControlAdvancedOperation | null {
  return value === "merge" ||
    value === "rebase" ||
    value === "cherry-pick" ||
    value === "revert"
    ? value
    : null;
}

function mergeSideOf(value: string): MergeSide | null {
  return value === "base" || value === "ours" || value === "theirs"
    ? value
    : null;
}

/** Which field of an action carries the source of one operation. */
function operationSource(
  action: PluginSourceControlAction,
  operation: PluginSourceControlAdvancedOperation,
): string {
  return operation === "merge" || operation === "rebase"
    ? text(action, "ref")
    : text(action, "commitId");
}

function missingSourceRefusal(
  operation: PluginSourceControlAdvancedOperation,
): string {
  return operation === "merge" || operation === "rebase"
    ? "Choose the branch to use first."
    : "Select the commit to use on the History tab first.";
}

function riskOf(
  operation: PluginSourceControlAdvancedOperation,
): PluginSourceControlOperationPlan["risk"] {
  if (operation === "rebase") {
    return "rewrites-history";
  }
  return operation === "merge" ? "may-conflict" : "creates-commit";
}

/** Plain sentences describing exactly what one operation would do. */
function describeOperation(
  operation: PluginSourceControlAdvancedOperation,
  source: string,
  branch: string | null,
): string {
  const current = branch ?? "the current branch";
  switch (operation) {
    case "merge":
      return `Merge ${source} into ${current}. Commits already on ${current} keep their identity, and a merge that cannot combine both sides automatically stops with conflicts for you to resolve.`;
    case "rebase":
      return `Replay the commits of ${current} on top of ${source}. This rewrites those commits: they are recorded again with new identities, so anyone who already has them will see a different history.`;
    case "cherry-pick":
      return `Record the change made by ${source} as a new commit on ${current}. The original commit is left exactly as it is.`;
    default:
      return `Record a new commit on ${current} that undoes the change made by ${source}. The original commit stays in the history.`;
  }
}

function operationLabel(
  operation: PluginSourceControlAdvancedOperation,
): string {
  switch (operation) {
    case "merge":
      return "Merge";
    case "rebase":
      return "Rebase";
    case "cherry-pick":
      return "Cherry-pick";
    default:
      return "Revert";
  }
}

function busyMessageFor(
  operation: PluginSourceControlAdvancedOperation,
  source: string,
): string {
  switch (operation) {
    case "merge":
      return `Merging ${source}`;
    case "rebase":
      return `Rebasing onto ${source}`;
    case "cherry-pick":
      return `Cherry-picking ${source}`;
    default:
      return `Reverting ${source}`;
  }
}

/** The exact typed request one advanced operation issues. */
function advancedRequest(
  operation: PluginSourceControlAdvancedOperation,
  source: string,
  scope: "vault" | "project",
): PluginGitRunRequest {
  switch (operation) {
    case "merge":
      return { operation: "merge", scope, ref: source };
    case "rebase":
      return { operation: "rebase", scope, upstream: source };
    case "cherry-pick":
      return { operation: "cherry-pick", scope, commit: source };
    default:
      return { operation: "revert", scope, commit: source };
  }
}

function succeededSummary(
  operation: PluginSourceControlAdvancedOperation,
  source: string,
): string {
  switch (operation) {
    case "merge":
      return `${source} is merged.`;
    case "rebase":
      return `Your commits are replayed on top of ${source}.`;
    case "cherry-pick":
      return `${source} is recorded as a new commit here.`;
    default:
      return `${source} is undone by a new commit.`;
  }
}

function stoppedSummary(
  operation: PluginSourceControlAdvancedOperation,
  source: string,
  conflicts: number,
): string {
  const files =
    conflicts > 0
      ? `${conflicts} file${conflicts === 1 ? "" : "s"} need${conflicts === 1 ? "s" : ""} resolving`
      : "Git stopped part way through";
  return `The ${operation} of ${source} stopped: ${files}. Resolve each conflicted file, then continue. Aborting puts the repository back as it was.`;
}

function resumedSummary(
  step: "continue" | "skip" | "abort",
  operation: PluginSourceControlAdvancedOperation,
  model: PluginSourceControlViewModel,
): string {
  if (step === "abort") {
    return `The ${operation} was aborted, and the repository is back where it started.`;
  }
  if (model.operationProgress) {
    return `The ${operation} moved on and is still in progress.`;
  }
  return step === "skip"
    ? `That step was skipped and the ${operation} finished.`
    : `The ${operation} finished.`;
}

/** One recorded side of a conflict, before anything has been read for it. */
function side(
  stage: MergeSide,
  label: string,
  present: boolean,
): PluginSourceControlConflictSide {
  return { side: stage, label, present, text: null, byteLength: 0 };
}

/**
 * Describes the open conflict for a surface.
 *
 * Every chunk carries all three recorded sides, so nothing a side holds is
 * dropped from the model even when the result does not use it, and a chunk
 * nobody has answered is reported as unanswered rather than given a side.
 */
function detailOf(
  editor: ConflictEditor,
  loading: boolean,
): PluginSourceControlConflictDetail {
  const chunks = editor.merge
    ? editor.merge.chunks.map((chunk) => ({
        id: chunk.id,
        kind: chunk.kind,
        base: chunk.base,
        ours: chunk.ours,
        theirs: chunk.theirs,
        choice:
          chunk.kind === "conflict"
            ? (editor.choices[chunk.id] ?? null)
            : chunk.automatic,
        automatic: chunk.kind !== "conflict",
      }))
    : [];
  return {
    path: editor.path,
    operation: editor.operation,
    binary: editor.binary,
    encrypted: editor.encrypted,
    base: editor.sides.base,
    ours: editor.sides.ours,
    theirs: editor.sides.theirs,
    chunks,
    result: editor.result,
    unsavedResult: editor.dirty,
    unresolvedChunks: editor.merge
      ? unresolvedChunkIds(editor.merge, editor.choices).length
      : 0,
    wholeSideOnly: editor.merge === null,
    limitation: editor.limitation,
    status: editor.status,
    error: editor.error,
    loading,
  };
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

/**
 * Names a branch in a message, and says plainly when there is none. A detached
 * HEAD has no branch to name, and inventing one would describe a repository
 * the user is not in.
 */
function branchLabel(branch: string | null): string {
  return branch ?? "no branch (a detached HEAD)";
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
