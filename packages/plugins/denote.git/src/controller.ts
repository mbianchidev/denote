import type {
  PluginGitCapability,
  PluginGitResult,
  PluginGitRunRequest,
  PluginSourceControlAction,
  PluginSourceControlOperationReview,
  PluginSourceControlRemoteAccess,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import {
  initialModel,
  refreshedModel,
  selectionOf,
  uninitializedModel,
  withBusy,
  withRecovery,
  withRemoteAccess,
  withReview,
  withSelection,
  type GitRepositoryScope,
  type GitSelection,
} from "./model";
import {
  describeOperationState,
  parseBranches,
  parseHistory,
  parseInitialized,
  parseOperationState,
  parseRemotes,
} from "./repositoryOutput";
import { parseStatus } from "./statusOutput";
import { readGitSettings } from "./settings";

const HISTORY_COUNT = 20;
const MAX_REPORTED_ERROR_LENGTH = 200;
const REPOSITORY_LIST_LIMIT = 50;

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
        this.selectCommit(text(action, "commitId"));
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

  private selectCommit(commitId: string): void {
    if (!commitId || this.current.selectedTab !== "history") {
      return;
    }
    this.publish(
      withSelection(this.current, {
        tab: "history",
        view: { kind: "commit", commitId },
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
      if (generation === this.generation) {
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
    if (!parseInitialized(discover.stdout)) {
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
      maxCount: HISTORY_COUNT,
    });
    this.publish(
      refreshedModel(this.scope, selectionOf(this.current), {
        status: parseStatus(status.stdout),
        branches: parseBranches(branches.stdout),
        remotes: parseRemotes(remotes.stdout),
        history: parseHistory(history.stdout),
        recovery: interruptedOperation(state.stdout),
        remoteAccess: this.remoteAccess,
      }),
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
    if (!parseInitialized(discover.stdout)) {
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

function describeAction(actionId: string): string {
  switch (actionId) {
    case "switch-branch":
      return "switch branches";
    case "open-diff":
      return "show file diffs";
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
