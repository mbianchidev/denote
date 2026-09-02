import type {
  PluginGitCapability,
  PluginGitCloneCleanupResult,
  PluginGitCloneVaultOperation,
  PluginGitCloneVaultRequest,
  PluginGitCloneVaultResult,
  PluginGitHubListOperation,
  PluginGitHubListRequest,
  PluginGitHubRepository,
  PluginGitResult,
  PluginGitRepositoryTarget,
  PluginGitRunRequest,
} from "@denote/plugin-sdk";

export type PluginGitDispatch = (
  request: unknown,
  operationId: string,
) => Promise<PluginGitResult>;

/** Dispatches one host-owned Git operation that is not a Git command. */
export type PluginGitHostDispatch = <T>(
  operation: string,
  value: unknown,
  operationId?: string,
) => Promise<T>;

/**
 * Builds the plugin-facing Git capability.
 *
 * Every invocation carries an operation ID that is generated before the
 * request is dispatched and returned to the plugin immediately, so a plugin
 * holds the ID it needs to cancel a long-running operation from a concurrent
 * source-control action instead of only learning it once the operation is
 * already finished.
 *
 * An invocation carries the request and nothing else. The Git executable, the
 * GitHub CLI, the clone destination, and every credential are host-owned, so
 * no call site can name one.
 */
export function createGitCapability(
  dispatch: PluginGitDispatch,
  host: PluginGitHostDispatch,
): PluginGitCapability {
  return {
    run: (
      request: PluginGitRunRequest,
      target?: PluginGitRepositoryTarget,
    ) => {
      const operationId = crypto.randomUUID();
      return {
        operationId,
        result: dispatch({ request, target: target ?? null }, operationId),
      };
    },
    cancel: (operationId: string) =>
      dispatch({ operation: "cancel", operationId }, crypto.randomUUID()),
    // Both of these reach the network through the host, so both are
    // cancellable, and both hand the ID back before the work is awaited so a
    // surface can offer Cancel while it runs.
    listGitHubRepositories: (
      request: PluginGitHubListRequest,
    ): PluginGitHubListOperation => {
      const operationId = crypto.randomUUID();
      return {
        operationId,
        result: host<PluginGitHubRepository[]>(
          "git.list-github-repositories",
          request,
          operationId,
        ),
      };
    },
    cloneVault: (
      request: PluginGitCloneVaultRequest,
    ): PluginGitCloneVaultOperation => {
      const operationId = crypto.randomUUID();
      return {
        operationId,
        result: host<PluginGitCloneVaultResult>(
          "git.clone-vault",
          request,
          operationId,
        ),
      };
    },
    cleanFailedClone: (cleanupToken: string) =>
      host<PluginGitCloneCleanupResult>("git.clean-failed-clone", {
        cleanupToken,
      }),
  };
}
