import { describe, expect, it, vi } from "vitest";
import type { PluginGitResult } from "@denote/plugin-sdk";
import { createGitCapability } from "./gitCapability";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const capability = createGitCapability(dispatch);

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
    const capability = createGitCapability(dispatch);

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
    const capability = createGitCapability((_request, operationId) =>
      Promise.resolve(result(operationId)),
    );

    const first = capability.run({ operation: "status", scope: "vault" });
    const second = capability.run({ operation: "status", scope: "vault" });

    expect(first.operationId).not.toBe(second.operationId);
  });

  it("dispatches the request and its operation ID and nothing else", () => {
    const dispatch = vi.fn((_request: unknown, operationId: string) =>
      Promise.resolve(result(operationId)),
    );
    const capability = createGitCapability(dispatch);

    // The Git executable is host-owned, read from persisted plugin settings,
    // so an invocation has nowhere to name one.
    const operation = capability.run({ operation: "status", scope: "vault" });

    expect(dispatch.mock.calls[0]).toEqual([
      { operation: "status", scope: "vault" },
      operation.operationId,
    ]);
  });

  it("cancels with the request and a fresh invocation ID only", async () => {
    const dispatch = vi.fn((_request: unknown, operationId: string) =>
      Promise.resolve(result(operationId)),
    );
    const capability = createGitCapability(dispatch);

    const operation = capability.run({ operation: "status", scope: "vault" });
    await capability.cancel(operation.operationId);

    expect(dispatch.mock.calls[1]).toHaveLength(2);
  });
});
