import { describe, expect, it } from "vitest";
import type { PluginActionLeaseScope } from "./hostOperations";
import { takeHostOperationScope } from "./workerRuntime";

describe("takeHostOperationScope", () => {
  it("consumes the host-selected clone destination after one clone request", () => {
    const scope = {
      workspaceScope: "/synthetic-vault",
      projectId: null,
      sourceControlActionId: "clone",
      gitCloneDestinationToken: "synthetic-destination",
    };
    const first = takeHostOperationScope(scope, "git.clone-vault", {});
    const second = takeHostOperationScope(scope, "git.clone-vault", {});
    expect(first).toMatchObject({ gitCloneDestinationToken: "synthetic-destination" });
    expect(second).not.toHaveProperty("gitCloneDestinationToken");
  });

  it("consumes commit signing values after one host request", () => {
    const scope: PluginActionLeaseScope = {
      workspaceScope: "/synthetic-vault",
      projectId: null,
      sourceControlActionId: "commit",
      gitCommitSign: true,
      gitSigningPassphrase: "synthetic-passphrase",
    };
    const request = {
      request: {
        operation: "commit",
        scope: "vault",
        message: "Synthetic commit",
      },
      target: null,
    };

    const first = takeHostOperationScope(scope, "git.run", request);
    const second = takeHostOperationScope(scope, "git.run", request);

    expect(first).toMatchObject({
      gitCommitSign: true,
      gitSigningPassphrase: "synthetic-passphrase",
    });
    expect(second?.gitCommitSign).toBeUndefined();
    expect(second?.gitSigningPassphrase).toBeUndefined();
  });
});
