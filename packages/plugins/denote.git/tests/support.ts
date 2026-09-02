import type {
  PluginGitCapability,
  PluginGitResult,
  PluginGitRunRequest,
} from "@denote/plugin-sdk";

export interface RecordedGitCall {
  request: PluginGitRunRequest;
  operationId: string;
}

export type GitResponder = (
  request: PluginGitRunRequest,
) => Partial<PluginGitResult> | Promise<Partial<PluginGitResult>>;

/** Synthetic stand-in for the host Git capability. It never runs a process. */
export class FakeGit implements PluginGitCapability {
  readonly calls: RecordedGitCall[] = [];
  readonly cancelled: string[] = [];
  private counter = 0;

  constructor(
    private readonly responder: GitResponder = defaultResponder,
    /**
     * Reports what the host says about a cancellation. The host answers
     * `cancelled: false` when no operation matches the ID it was given.
     */
    private readonly cancelResponder: (
      operationId: string,
    ) => Partial<PluginGitResult> = () => ({ cancelled: true }),
  ) {}

  run(request: PluginGitRunRequest) {
    this.counter += 1;
    const operationId = `operation-${this.counter}`;
    this.calls.push({ request, operationId });
    const result = Promise.resolve(this.responder(request)).then((partial) => ({
      operationId,
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: false,
      ...partial,
    }));
    return { operationId, result };
  }

  cancel(operationId: string): Promise<PluginGitResult> {
    this.cancelled.push(operationId);
    return Promise.resolve({
      operationId,
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: true,
      ...this.cancelResponder(operationId),
    });
  }

  get operations(): string[] {
    return this.calls.map((call) => call.request.operation);
  }

  request(operation: string): PluginGitRunRequest | undefined {
    return this.calls.find((call) => call.request.operation === operation)
      ?.request;
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export const SYNTHETIC_STATUS = [
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +1 -0",
  "1 M. N... 100644 100644 100644 1111111 2222222 notes/staged.md",
  "1 .M N... 100644 100644 100644 1111111 2222222 notes/changed.md",
  "? notes/new.md",
].join("\0");

export const SYNTHETIC_BRANCHES = [
  "refs/heads/main\t1111111111111111111111111111111111111111\t*\trefs/remotes/origin/main\t[ahead 1]",
  "refs/heads/topic\t2222222222222222222222222222222222222222\t \t\t",
].join("\n");

export const SYNTHETIC_REMOTES = [
  "origin\thttps://example.invalid/synthetic.git (fetch)",
  "origin\thttps://example.invalid/synthetic.git (push)",
].join("\n");

/**
 * Two synthetic commits in the host's NUL delimited history report. The author
 * name and the subject both contain tabs, so a parser that split on tabs would
 * misread every field after them.
 */
export const SYNTHETIC_HISTORY = [
  "1111111111111111111111111111111111111111",
  "1111111",
  "Synthetic\tAuthor",
  "2026-01-01T00:00:00+00:00",
  "",
  "HEAD -> main",
  "Record\ta synthetic note",
  "2222222222222222222222222222222222222222",
  "2222222",
  "Second Author",
  "2025-12-31T00:00:00+00:00",
  "1111111111111111111111111111111111111111",
  "",
  "Add a synthetic note",
  "",
].join("\0");

export const IDLE_OPERATION_STATE = JSON.stringify({
  mergeInProgress: false,
  cherryPickInProgress: false,
  revertInProgress: false,
  rebaseInProgress: false,
  rebaseKind: null,
  sequencerInProgress: false,
  bisectInProgress: false,
});

function defaultResponder(): Partial<PluginGitResult> {
  return {};
}

/** Canned output for a synthetic initialized repository. */
export function repositoryResponder(
  overrides: Partial<Record<string, Partial<PluginGitResult>>> = {},
): GitResponder {
  return (request) => {
    const override = overrides[request.operation];
    if (override) {
      return override;
    }
    switch (request.operation) {
      case "discover":
        return { stdout: JSON.stringify({ initialized: true }) };
      case "status":
        return { stdout: SYNTHETIC_STATUS };
      case "list-branches":
        return { stdout: SYNTHETIC_BRANCHES };
      case "list-remotes":
        return { stdout: SYNTHETIC_REMOTES };
      case "operation-state":
        return { stdout: IDLE_OPERATION_STATE };
      case "list-history":
        return { stdout: SYNTHETIC_HISTORY };
      default:
        return {};
    }
  };
}

/** `Array.prototype.at` is newer than the plugin language target. */
export function last<T>(values: T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}
