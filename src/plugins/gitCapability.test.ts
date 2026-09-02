import { describe, expect, it, vi } from "vitest";
import type { PluginGitResult } from "@denote/plugin-sdk";
import {
  createGitCapability,
  type PluginGitHostDispatch,
} from "./gitCapability";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stands in for the host operations a Git command never goes through. */
function hostDispatch(): PluginGitHostDispatch {
  return (() => Promise.resolve(undefined)) as PluginGitHostDispatch;
}

function result(operationId: string): PluginGitResult {
  return {
    operationId,
    exitCode: 0,
    stdout: "",
    stderr: "",
    cancelled: false,
  };
}

describe("plugin Git capability", () => {
  it("returns the operation ID before the operation completes", async () => {
    const resolvers: Array<(value: PluginGitResult) => void> = [];
    const dispatch = vi.fn(
      () =>
        new Promise<PluginGitResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const capability = createGitCapability(dispatch, hostDispatch());

    const operation = capability.run({ operation: "status", scope: "vault" });

    expect(operation.operationId).toMatch(UUID);
    expect(dispatch).toHaveBeenCalledWith(
      { operation: "status", scope: "vault" },
      operation.operationId,
    );
    expect(resolvers).toHaveLength(1);
    resolvers[0](result(operation.operationId));
    await expect(operation.result).resolves.toMatchObject({
      operationId: operation.operationId,
    });
  });

  it("cancels a running operation by the ID the caller already holds", async () => {
    const dispatch = vi.fn((_request: unknown, operationId: string) =>
      Promise.resolve(result(operationId)),
    );
    const capability = createGitCapability(dispatch, hostDispatch());

    const operation = capability.run({
      operation: "push",
      scope: "vault",
      remote: "origin",
      branch: "main",
    });
    await capability.cancel(operation.operationId);

    const [request, cancelInvocationId] = dispatch.mock.calls[1];
    expect(request).toEqual({
      operation: "cancel",
      operationId: operation.operationId,
    });
    expect(cancelInvocationId).toMatch(UUID);
    expect(cancelInvocationId).not.toBe(operation.operationId);
  });

  it("gives every operation its own ID", () => {
    const capability = createGitCapability(
      (_request, operationId) => Promise.resolve(result(operationId)),
      hostDispatch(),
    );

    const first = capability.run({ operation: "status", scope: "vault" });
    const second = capability.run({ operation: "status", scope: "vault" });

    expect(first.operationId).not.toBe(second.operationId);
  });

  it("dispatches the request and its operation ID and nothing else", () => {
    const dispatch = vi.fn((_request: unknown, operationId: string) =>
      Promise.resolve(result(operationId)),
    );
    const capability = createGitCapability(dispatch, hostDispatch());

    // The Git executable is host-owned, read from persisted plugin settings,
    // so an invocation has nowhere to name one.
    const operation = capability.run({ operation: "status", scope: "vault" });

    expect(dispatch.mock.calls[0]).toEqual([
      { operation: "status", scope: "vault" },
      operation.operationId,
    ]);
  });

  it("routes host-owned Git operations away from the Git command dispatcher", async () => {
    const dispatch = vi.fn((_request: unknown, operationId: string) =>
      Promise.resolve(result(operationId)),
    );
    const host = vi.fn(
      (_operation: string, _value: unknown, _operationId?: string) =>
        Promise.resolve([]),
    );
    const capability = createGitCapability(
      dispatch,
      host as unknown as PluginGitHostDispatch,
    );

    const listing = capability.listGitHubRepositories({ limit: 10 });
    await listing.result;
    await capability.cleanFailedClone("11111111-2222-4333-8444-555555555555");
    const clone = capability.cloneVault({
      url: "https://github.com/synthetic-owner/synthetic-notes.git",
      authMode: "github-https",
    });
    await clone.result;

    // Nothing host-owned is ever expressed as a Git command.
    expect(dispatch).not.toHaveBeenCalled();
    expect(host.mock.calls.map((call) => call[0])).toEqual([
      "git.list-github-repositories",
      "git.clean-failed-clone",
      "git.clone-vault",
    ]);
    // Both operations that reach the network are cancellable, so each one
    // hands back the ID it was dispatched with before its work is awaited.
    // Deleting a failed clone is a short local read with nothing to cancel.
    expect(listing.operationId).toMatch(UUID);
    expect(host.mock.calls[0][2]).toBe(listing.operationId);
    expect(host.mock.calls[1][2]).toBeUndefined();
    expect(clone.operationId).toMatch(UUID);
    expect(host.mock.calls[2][2]).toBe(clone.operationId);
    expect(clone.operationId).not.toBe(listing.operationId);
  });

  it("cancels with the request and a fresh invocation ID only", async () => {
    const dispatch = vi.fn((_request: unknown, operationId: string) =>
      Promise.resolve(result(operationId)),
    );
    const capability = createGitCapability(dispatch, hostDispatch());

    const operation = capability.run({ operation: "status", scope: "vault" });
    await capability.cancel(operation.operationId);

    expect(dispatch.mock.calls[1]).toHaveLength(2);
  });
});
