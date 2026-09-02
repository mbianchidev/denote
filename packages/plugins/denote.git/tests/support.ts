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
  PluginGitRunRequest,
} from "@denote/plugin-sdk";

export interface RecordedGitCall {
  request: PluginGitRunRequest;
  operationId: string;
}

export type GitResponder = (
  request: PluginGitRunRequest,
) => Partial<PluginGitResult> | Promise<Partial<PluginGitResult>>;

/**
 * Host-owned operations that are not Git commands. Each one is answered with a
 * fixed synthetic value, because the real ones resolve executables, read
 * credentials, and open a folder chooser.
 */
export interface FakeGitHostResponses {
  repositories?: PluginGitHubRepository[];
  clone?: PluginGitCloneVaultResult;
  cleanup?: PluginGitCloneCleanupResult;
  /** Delays the clone so a test can observe the published operation ID. */
  clonePending?: Promise<PluginGitCloneVaultResult>;
  /** Delays the listing so a test can observe the published operation ID. */
  listPending?: Promise<PluginGitHubRepository[]>;
}

export const SYNTHETIC_REPOSITORY: PluginGitHubRepository = {
  nameWithOwner: "synthetic-owner/synthetic-notes",
  httpsUrl: "https://github.com/synthetic-owner/synthetic-notes.git",
  sshUrl: "ssh://git@github.com/synthetic-owner/synthetic-notes.git",
  defaultBranch: "main",
  private: false,
};

/** Synthetic stand-in for the host Git capability. It never runs a process. */
export class FakeGit implements PluginGitCapability {
  readonly calls: RecordedGitCall[] = [];
  readonly cancelled: string[] = [];
  readonly listed: PluginGitHubListRequest[] = [];
  readonly clones: PluginGitCloneVaultRequest[] = [];
  readonly cloneOperationIds: string[] = [];
  readonly listOperationIds: string[] = [];
  readonly cleanups: string[] = [];
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
    private readonly host: FakeGitHostResponses = {},
  ) {}

  listGitHubRepositories(
    request: PluginGitHubListRequest,
  ): PluginGitHubListOperation {
    this.listed.push(request);
    this.counter += 1;
    const operationId = `list-${this.counter}`;
    this.listOperationIds.push(operationId);
    return {
      operationId,
      result:
        this.host.listPending ??
        Promise.resolve(this.host.repositories ?? []),
    };
  }

  cloneVault(
    request: PluginGitCloneVaultRequest,
  ): PluginGitCloneVaultOperation {
    this.clones.push(request);
    this.counter += 1;
    const operationId = `clone-${this.counter}`;
    this.cloneOperationIds.push(operationId);
    return {
      operationId,
      result:
        this.host.clonePending ??
        Promise.resolve(this.host.clone ?? { status: "cancelled" }),
    };
  }

  cleanFailedClone(cleanupToken: string): Promise<PluginGitCloneCleanupResult> {
    this.cleanups.push(cleanupToken);
    return Promise.resolve(
      this.host.cleanup ?? {
        cleaned: true,
        message: "Denote deleted the incomplete clone folder.",
      },
    );
  }

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
  sequencerKind: null,
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
        return {
          stdout: JSON.stringify({ initialized: true, encrypted: false }),
        };
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

/** The same branches plus one remote-tracking branch to check out. */
export const SYNTHETIC_BRANCHES_WITH_REMOTE = [
  "refs/heads/main\t1111111111111111111111111111111111111111\t*\trefs/remotes/origin/main\t[ahead 1]",
  "refs/heads/topic\t2222222222222222222222222222222222222222\t \t\t",
  "refs/remotes/origin/main\t1111111111111111111111111111111111111111\t \t\t",
  "refs/remotes/origin/release\t3333333333333333333333333333333333333333\t \t\t",
].join("\n");

/** A clean working tree: nothing staged, changed, untracked, or conflicted. */
export const CLEAN_STATUS = [
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +0 -0",
].join("\0");

/** One conflicted path, so a checkout has to be refused outright. */
export const CONFLICTED_STATUS = [
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 notes/conflict.md",
].join("\0");

/** Two hunks in one synthetic note, as Git reports an unstaged change. */
export const SYNTHETIC_DIFF = [
  "diff --git a/notes/changed.md b/notes/changed.md",
  "index 1111111..2222222 100644",
  "--- a/notes/changed.md",
  "+++ b/notes/changed.md",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "@@ -7,3 +7,3 @@",
  " seven",
  "-eight",
  "+EIGHT",
  " nine",
  "",
].join("\n");

/**
 * The same shape of change in a file with CRLF endings. Git reports the
 * carriage return as part of each line, so it has to survive parsing and be
 * sent back unchanged or the reconstructed patch would not match the file.
 */
export const CRLF_DIFF = [
  "diff --git a/notes/changed.md b/notes/changed.md",
  "index 1111111..2222222 100644",
  "--- a/notes/changed.md",
  "+++ b/notes/changed.md",
  "@@ -1,3 +1,3 @@",
  " one\r",
  "-two\r",
  "+TWO\r",
  " three\r",
  "",
].join("\n");

/** `Array.prototype.at` is newer than the plugin language target. */
export function last<T>(values: T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

/**
 * Builds a synthetic NUL delimited history report.
 *
 * Commit IDs are the record's own index written out, so a test can name the
 * exact commit it expects on a page without depending on a real repository.
 */
export function syntheticHistory(
  count: number,
  offset = 0,
  overrides: Record<number, { parentIds?: string[]; refs?: string }> = {},
): string {
  const fields: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const number = offset + index;
    const override = overrides[number] ?? {};
    fields.push(
      commitId(number),
      commitId(number).slice(0, 7),
      "Synthetic Author",
      "2026-01-01T00:00:00+00:00",
      (override.parentIds ?? [commitId(number + 1)]).join(" "),
      override.refs ?? "",
      `Record synthetic note ${number}`,
    );
  }
  return `${fields.join("\0")}\0`;
}

/** The 40-character commit ID a synthetic history record number maps to. */
export function commitId(number: number): string {
  return String(number).padStart(40, "0");
}

/**
 * One commit's diff, with the commit header and message the host suppresses
 * still present. The host asks Git not to print them, so this is the belt to
 * that braces: a message that quotes a diff header is indented by Git and can
 * never start a file, whichever way the report was produced.
 */
export const SYNTHETIC_COMMIT_DIFF = [
  `commit ${commitId(0)}`,
  "Author: Synthetic Author <author@example.invalid>",
  "Date:   Thu Jan 1 00:00:00 2026 +0000",
  "",
  "    Record synthetic note 0",
  "",
  "    diff --git a/notes/injected.md b/notes/injected.md",
  "",
  "diff --git a/notes/changed.md b/notes/changed.md",
  "index 1111111..2222222 100644",
  "--- a/notes/changed.md",
  "+++ b/notes/changed.md",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "diff --git a/notes/added.md b/notes/added.md",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/notes/added.md",
  "@@ -0,0 +1,1 @@",
  "+added synthetic line",
  "",
].join("\n");

/** One commit that renamed a note and deleted another. */
export const RENAME_COMMIT_DIFF = [
  `commit ${commitId(0)}`,
  "Author: Synthetic Author <author@example.invalid>",
  "Date:   Thu Jan 1 00:00:00 2026 +0000",
  "",
  "    Rename and delete synthetic notes",
  "",
  "diff --git a/notes/old name.md b/notes/new name.md",
  "similarity index 100%",
  "rename from notes/old name.md",
  "rename to notes/new name.md",
  "diff --git a/notes/removed.md b/notes/removed.md",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/notes/removed.md",
  "+++ /dev/null",
  "@@ -1,1 +0,0 @@",
  "-gone",
  "",
].join("\n");

/** One commit whose only change is a file Git refuses to show as text. */
export const BINARY_COMMIT_DIFF = [
  `commit ${commitId(0)}`,
  "Author: Synthetic Author <author@example.invalid>",
  "Date:   Thu Jan 1 00:00:00 2026 +0000",
  "",
  "    Record a sealed note",
  "",
  "diff --git a/notes/sealed.md b/notes/sealed.md",
  "index 5555555..6666666 100644",
  "Binary files a/notes/sealed.md and b/notes/sealed.md differ",
  "",
].join("\n");

/**
 * A synthetic status report whose only entries are conflicted paths, so a test
 * can name exactly which files Git still reports as unmerged.
 */
export function conflictedStatus(paths: string[], branch = "main"): string {
  return [
    "# branch.oid 1111111111111111111111111111111111111111",
    `# branch.head ${branch}`,
    ...paths.map(
      (path) =>
        `u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 ${path}`,
    ),
  ].join("\0");
}

/** The host's operation-state report with the named flags turned on. */
export function operationState(
  overrides: Partial<Record<string, boolean | string | null>> = {},
): string {
  return JSON.stringify({
    ...(JSON.parse(IDLE_OPERATION_STATE) as Record<string, unknown>),
    ...overrides,
  });
}

/**
 * A synthetic `ls-files --unmerged -z` report. Each entry names the stages the
 * index holds, so a test can describe an added/added conflict, which has no
 * common ancestor, exactly as Git would.
 */
export function unmergedListing(
  entries: Array<{ path: string; stages: number[] }>,
): string {
  return entries
    .flatMap((entry) =>
      entry.stages.map(
        (stage) => `100644 ${"1".repeat(40)} ${stage}\t${entry.path}\0`,
      ),
    )
    .join("");
}

/** Base64 of UTF-8 text, as the host returns one conflict stage. */
export function stageBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
