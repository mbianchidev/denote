import type {
  PluginGitCapability,
  PluginGitResult,
  PluginGitRunRequest,
} from "@denote/plugin-sdk";

export type PluginGitDispatch = (
  request: unknown,
  operationId: string,
) => Promise<PluginGitResult>;

/**
 * Builds the plugin-facing Git capability.
 *
 * Every invocation carries an operation ID that is generated before the
 * request is dispatched and returned to the plugin immediately, so a plugin
 * holds the ID it needs to cancel a long-running operation from a concurrent
 * source-control action instead of only learning it once the operation is
 * already finished.
 *
 * An invocation carries the request and nothing else. The Git executable is
 * host-owned: the native transport reads it from the plugin's persisted
 * settings, so no call site can name an executable of its own.
 */
export function createGitCapability(
  dispatch: PluginGitDispatch,
): PluginGitCapability {
  return {
    run: (request: PluginGitRunRequest) => {
      const operationId = crypto.randomUUID();
      return { operationId, result: dispatch(request, operationId) };
    },
    cancel: (operationId: string) =>
      dispatch({ operation: "cancel", operationId }, crypto.randomUUID()),
  };
}
