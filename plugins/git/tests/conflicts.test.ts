import { describe, expect, it } from "vitest";
import type {
  PluginGitRunRequest,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { vaultScope } from "../src/model";
import {
  CLEAN_STATUS,
  FakeGit,
  conflictedStatus,
  operationState,
  repositoryResponder,
  stageBase64,
  syntheticHistory,
  unmergedListing,
} from "./support";

interface Harness {
  controller: GitRepositoryController;
  published: PluginSourceControlViewModel[];
  reports: string[];
}

function harness(settings: Record<string, unknown> = {}): Harness {
  const published: PluginSourceControlViewModel[] = [];
  const reports: string[] = [];
  const controller = new GitRepositoryController(vaultScope(), {
    publish: (model) => published.push(model),
    readSettings: () => Promise.resolve(settings),
    report: (message) => reports.push(message),
  });
  return { controller, published, reports };
}

const CONFLICTED_PATH = "notes/conflict.md";

interface ConflictFixture {
  base?: string | null;
  ours?: string | null;
  theirs?: string | null;
  stages?: number[];
  encrypted?: boolean;
  paths?: string[];
  /** Stage reads that must fail, as Git does when the index lost a stage. */
  failing?: string[];
  /** Raw base64 for one stage, so a test can supply bytes that are not text. */
  raw?: Partial<Record<"base" | "ours" | "theirs", string>>;
}

/**
 * A repository in a conflicted merge, whose stage reads return exactly the
 * synthetic sides a test names.
 */
function conflictGit(fixture: ConflictFixture = {}): FakeGit {
  const {
    base = "one\ntwo\nthree\n",
    ours = "one\nOURS\nthree\n",
    theirs = "one\ntwo\nTHEIRS\n",
    stages = [1, 2, 3],
    encrypted = false,
    paths = [CONFLICTED_PATH],
    failing = [],
    raw = {},
  } = fixture;
  const texts: Record<string, string | null> = { base, ours, theirs };
  return new FakeGit((request: PluginGitRunRequest) => {
    if (request.operation === "read-conflict-stage") {
      const stage = request.stage;
      if (failing.includes(stage)) {
        return { exitCode: 128, stderr: "fatal: path is not in the index" };
      }
      const supplied = raw[stage];
      if (supplied !== undefined) {
        return { stdout: supplied };
      }
      const text = texts[stage];
      return { stdout: text === null ? "" : stageBase64(text) };
    }
    if (request.operation === "list-conflicts") {
      return {
        stdout: unmergedListing(
          paths.map((path) => ({
            path,
            stages: paths.length > 1 ? [1, 2, 3] : stages,
          })),
        ),
      };
    }
    return repositoryResponder({
      discover: {
        stdout: JSON.stringify({ initialized: true, encrypted }),
      },
      status: { stdout: conflictedStatus(paths) },
      "operation-state": { stdout: operationState({ mergeInProgress: true }) },
      "list-history": { stdout: syntheticHistory(2) },
    })(request);
  });
}

/** Every stage the controller asked Git for. */
function stageReads(git: FakeGit): string[] {
  return git.calls
    .filter((call) => call.request.operation === "read-conflict-stage")
    .map((call) =>
      call.request.operation === "read-conflict-stage" ? call.request.stage : "",
    );
}

function recoveryMessage(model: PluginSourceControlViewModel): string {
  return model.recovery.state === "failed" ? model.recovery.message : "";
}

function conflictChunkIds(model: PluginSourceControlViewModel): string[] {
  return (model.conflictDetail?.chunks ?? [])
    .filter((chunk) => chunk.kind === "conflict")
    .map((chunk) => chunk.id);
}

async function openConflict(
  controller: GitRepositoryController,
  git: FakeGit,
  path = CONFLICTED_PATH,
): Promise<void> {
  await controller.runAction({ id: "refresh" }, git);
  await controller.runAction({ id: "open-conflict", values: { path } }, git);
}

describe("conflict editor", () => {
  it("verifies the path is still unmerged, then reads every recorded side", async () => {
    const { controller } = harness();
    const git = conflictGit();

    await openConflict(controller, git);

    expect(git.operations).toContain("list-conflicts");
    expect(stageReads(git)).toEqual(["base", "ours", "theirs"]);
    const detail = controller.model.conflictDetail;
    expect(detail).toMatchObject({
      path: CONFLICTED_PATH,
      operation: "merge",
      binary: false,
      encrypted: false,
      wholeSideOnly: false,
      loading: false,
      unsavedResult: false,
    });
    expect(detail?.base).toMatchObject({ present: true, text: "one\ntwo\nthree\n" });
    expect(detail?.ours).toMatchObject({ present: true, text: "one\nOURS\nthree\n" });
    expect(detail?.theirs).toMatchObject({
      present: true,
      text: "one\ntwo\nTHEIRS\n",
    });
    // The two sides changed different lines, so the merge combines them.
    expect(detail?.unresolvedChunks).toBe(0);
    expect(detail?.result).toBe("one\nOURS\nTHEIRS\n");
    expect(controller.model.selectedView).toEqual({
      kind: "conflict",
      path: CONFLICTED_PATH,
    });
  });

  it("refuses to open a path Git no longer reports as conflicted", async () => {
    const { controller } = harness();
    const git = conflictGit({ paths: [CONFLICTED_PATH] });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "open-conflict", values: { path: "notes/other.md" } },
      git,
    );

    expect(stageReads(git)).toEqual([]);
    expect(controller.model.conflictDetail).toBeNull();
    expect(recoveryMessage(controller.model)).toContain(
      "no longer reports notes/other.md as conflicted",
    );
  });

  it("shows a stage the index does not hold as absent instead of empty", async () => {
    const { controller } = harness();
    const git = conflictGit({ stages: [2, 3] });

    await openConflict(controller, git);

    expect(stageReads(git)).toEqual(["ours", "theirs"]);
    const detail = controller.model.conflictDetail;
    expect(detail?.base).toMatchObject({ present: false, text: null });
    expect(detail?.ours.present).toBe(true);
    // With no common ancestor the two sides conflict as a whole.
    expect(detail?.unresolvedChunks).toBe(1);
  });

  it("reports a stage that disappeared between the listing and the read", async () => {
    const { controller } = harness();
    const git = conflictGit({ failing: ["base"] });

    await openConflict(controller, git);

    const detail = controller.model.conflictDetail;
    expect(detail?.base).toMatchObject({ present: false, text: null });
    expect(detail?.status).toContain("no longer holds the base side");
  });

  it("never exposes line content for binary sides", async () => {
    const { controller } = harness();
    // Bytes that are not valid UTF-8 text.
    const git = conflictGit({ raw: { theirs: "//79" } });

    await openConflict(controller, git);

    const detail = controller.model.conflictDetail;
    expect(detail?.binary).toBe(true);
    expect(detail?.wholeSideOnly).toBe(true);
    expect(detail?.chunks).toEqual([]);
    expect(detail?.result).toBeNull();
    expect([detail?.base.text, detail?.ours.text, detail?.theirs.text]).toEqual([
      null,
      null,
      null,
    ]);
    expect(detail?.limitation).toContain("binary");
  });

  it("never reads or decodes a side of an encrypted vault", async () => {
    const { controller } = harness();
    const git = conflictGit({ encrypted: true });

    await openConflict(controller, git);

    expect(stageReads(git)).toEqual([]);
    const detail = controller.model.conflictDetail;
    expect(detail).toMatchObject({
      encrypted: true,
      wholeSideOnly: true,
      result: null,
    });
    expect(detail?.limitation).toContain("encrypted");
    expect(detail?.ours.present).toBe(true);
  });

  it("refuses to write plaintext into an encrypted conflict", async () => {
    const { controller } = harness();
    const git = conflictGit({ encrypted: true });
    await openConflict(controller, git);

    await controller.runAction({ id: "resolve-conflict" }, git);

    expect(git.operations).not.toContain("resolve-conflict");
    expect(recoveryMessage(controller.model)).toContain("encrypted");
  });

  it("stages one whole recorded side for an encrypted conflict", async () => {
    const { controller } = harness();
    const git = conflictGit({ encrypted: true });
    await openConflict(controller, git);

    await controller.runAction(
      { id: "resolve-conflict-stage", values: { side: "theirs" } },
      git,
    );

    expect(git.request("resolve-conflict")).toEqual({
      operation: "resolve-conflict",
      scope: "vault",
      path: CONFLICTED_PATH,
      resolution: { kind: "stage", stage: "theirs" },
    });
    expect(controller.model.conflictDetail).toBeNull();
  });

  it("refuses to stage a side the index does not hold", async () => {
    const { controller } = harness();
    const git = conflictGit({ stages: [2, 3] });
    await openConflict(controller, git);

    await controller.runAction(
      { id: "resolve-conflict-stage", values: { side: "base" } },
      git,
    );

    expect(git.operations).not.toContain("resolve-conflict");
    expect(recoveryMessage(controller.model)).toContain(
      "does not hold that side",
    );
  });

  it("answers one change at a time and keeps the result in step", async () => {
    const { controller } = harness();
    const git = conflictGit({
      base: "one\ntwo\nthree\n",
      ours: "one\nOURS\nthree\n",
      theirs: "one\nTHEIRS\nthree\n",
    });
    await openConflict(controller, git);
    const [chunkId] = conflictChunkIds(controller.model);
    expect(chunkId).toBeDefined();
    expect(controller.model.conflictDetail?.unresolvedChunks).toBe(1);

    await controller.runAction(
      { id: "choose-conflict-change", values: { chunkId, side: "theirs" } },
      git,
    );

    const detail = controller.model.conflictDetail;
    expect(detail?.result).toBe("one\nTHEIRS\nthree\n");
    expect(detail?.unresolvedChunks).toBe(0);
    expect(detail?.unsavedResult).toBe(true);
    const chunk = detail?.chunks.find((entry) => entry.id === chunkId);
    expect(chunk).toMatchObject({ choice: "theirs", automatic: false });
    // The other sides are still carried, so nothing is dropped by choosing.
    expect(chunk?.base).toEqual(["two"]);
    expect(chunk?.ours).toEqual(["OURS"]);
  });

  it("refuses a change that is not part of this conflict", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);

    await controller.runAction(
      {
        id: "choose-conflict-change",
        values: { chunkId: "chunk-404", side: "ours" },
      },
      git,
    );

    expect(recoveryMessage(controller.model)).toContain("no longer part");
  });

  it("takes one whole side as the result without writing anything", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);

    await controller.runAction(
      { id: "use-conflict-side", values: { side: "base" } },
      git,
    );

    expect(git.operations).not.toContain("resolve-conflict");
    expect(controller.model.conflictDetail?.result).toBe("one\ntwo\nthree\n");
    expect(controller.model.conflictDetail?.unsavedResult).toBe(true);
  });

  it("keeps a result the user typed by hand", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);

    await controller.runAction(
      { id: "edit-conflict-result", values: { result: "one\nmerged by hand\n" } },
      git,
    );

    expect(controller.model.conflictDetail?.result).toBe(
      "one\nmerged by hand\n",
    );
    expect(controller.model.conflictDetail?.unsavedResult).toBe(true);
    expect(controller.model.conflictDetail?.status).toContain("by hand");
  });

  it("marks a conflict resolved with the merged result as base64", async () => {
    const { controller } = harness();
    const git = conflictGit({ paths: [CONFLICTED_PATH, "notes/second.md"] });
    await openConflict(controller, git);
    await controller.runAction(
      { id: "edit-conflict-result", values: { result: "one\nmerged\n" } },
      git,
    );

    await controller.runAction({ id: "resolve-conflict" }, git);

    expect(git.request("resolve-conflict")).toEqual({
      operation: "resolve-conflict",
      scope: "vault",
      path: CONFLICTED_PATH,
      resolution: {
        kind: "content",
        contentBase64: stageBase64("one\nmerged\n"),
      },
    });
    // The editor closes, and every other conflicted file is untouched.
    expect(controller.model.conflictDetail).toBeNull();
    expect(controller.model.conflicts.map((entry) => entry.path)).toEqual([
      CONFLICTED_PATH,
      "notes/second.md",
    ]);
    expect(controller.model.remoteAccess.review?.detail).toContain(
      "still need",
    );
  });

  it("refuses to mark a conflict resolved while a change is unanswered", async () => {
    const { controller } = harness();
    const git = conflictGit({
      base: "one\ntwo\n",
      ours: "one\nOURS\n",
      theirs: "one\nTHEIRS\n",
    });
    await openConflict(controller, git);

    await controller.runAction({ id: "resolve-conflict" }, git);

    expect(git.operations).not.toContain("resolve-conflict");
    expect(recoveryMessage(controller.model)).toContain("still need");
  });

  it("does not leave the editor while a result is unsaved", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);
    await controller.runAction(
      { id: "edit-conflict-result", values: { result: "changed\n" } },
      git,
    );

    await controller.runAction({ id: "select-tab", values: { tab: "history" } }, git);
    expect(controller.model.selectedTab).toBe("changes");
    expect(recoveryMessage(controller.model)).toContain("has not been saved");

    await controller.runAction({ id: "close-conflict" }, git);
    expect(controller.model.conflictDetail).not.toBeNull();

    await controller.runAction({ id: "discard-conflict-result" }, git);
    expect(controller.model.conflictDetail?.unsavedResult).toBe(false);
    expect(controller.model.conflictDetail?.result).toBe("one\nOURS\nTHEIRS\n");

    await controller.runAction({ id: "close-conflict" }, git);
    expect(controller.model.conflictDetail).toBeNull();
    expect(controller.model.selectedView).toEqual({ kind: "repository" });
  });

  it("refuses to re-read a conflict whose result has not been saved", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);
    await controller.runAction(
      { id: "edit-conflict-result", values: { result: "by hand\n" } },
      git,
    );
    const reads = stageReads(git).length;

    await controller.runAction(
      { id: "open-conflict", values: { path: CONFLICTED_PATH } },
      git,
    );

    // Re-reading would rebuild the merge and drop the edit, so it is refused.
    expect(stageReads(git)).toHaveLength(reads);
    expect(controller.model.conflictDetail?.result).toBe("by hand\n");
    expect(controller.model.conflictDetail?.unsavedResult).toBe(true);
    expect(recoveryMessage(controller.model)).toContain("has not been saved");
  });

  it("closes the editor when the selection moves somewhere else", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);
    expect(controller.model.conflictDetail).not.toBeNull();

    await controller.runAction(
      { id: "select-tab", values: { tab: "history" } },
      git,
    );

    // Nothing unsaved was open, so the editor is simply gone: no model carries
    // a conflict the selection does not name.
    expect(controller.model.selectedTab).toBe("history");
    expect(controller.model.conflictDetail).toBeNull();

    await controller.runAction(
      { id: "choose-conflict-change", values: { chunkId: "chunk-1", side: "ours" } },
      git,
    );
    expect(recoveryMessage(controller.model)).toContain("No conflict is open");
  });

  it("closes an editor whose path is no longer conflicted, and says so", async () => {
    const { controller, reports } = harness();
    let resolved = false;
    const git = new FakeGit((request) => {
      if (request.operation === "status") {
        return {
          stdout: resolved ? CLEAN_STATUS : conflictedStatus([CONFLICTED_PATH]),
        };
      }
      if (request.operation === "list-conflicts") {
        return {
          stdout: unmergedListing([{ path: CONFLICTED_PATH, stages: [1, 2, 3] }]),
        };
      }
      if (request.operation === "read-conflict-stage") {
        return { stdout: stageBase64("one\n") };
      }
      if (request.operation === "operation-state") {
        return { stdout: operationState({ mergeInProgress: !resolved }) };
      }
      return repositoryResponder({
        "list-history": { stdout: syntheticHistory(2) },
      })(request);
    });
    await openConflict(controller, git);
    await controller.runAction(
      { id: "edit-conflict-result", values: { result: "typed\n" } },
      git,
    );

    resolved = true;
    await controller.runAction({ id: "refresh" }, git);

    expect(controller.model.conflictDetail).toBeNull();
    expect(controller.model.remoteAccess.review?.summary).toContain(
      "was not written",
    );
    expect(reports).toContain(
      "Closed a conflict editor for a path that is no longer conflicted.",
    );
  });

  it("reports an unsaved result that a repository change left behind", async () => {
    const { controller } = harness();
    const git = conflictGit();
    await openConflict(controller, git);
    await controller.runAction(
      { id: "edit-conflict-result", values: { result: "typed\n" } },
      git,
    );

    controller.setScope(
      { kind: "project", repositoryId: "project:synthetic", name: "Synthetic" },
    );

    expect(controller.model.conflictDetail).toBeNull();
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Conflict",
      outcome: "cancelled",
    });
    expect(controller.model.remoteAccess.review?.summary).toContain(
      CONFLICTED_PATH,
    );
  });

  it("keeps CRLF endings and Unicode exactly as Git recorded them", async () => {
    const { controller } = harness();
    const git = conflictGit({
      base: "one\r\nünïcödé\r\n",
      ours: "ONE 🌱\r\nünïcödé\r\n",
      theirs: "one\r\nünïcödé 行\r\n",
    });
    await openConflict(controller, git);

    await controller.runAction({ id: "resolve-conflict" }, git);

    expect(git.request("resolve-conflict")).toMatchObject({
      resolution: {
        kind: "content",
        contentBase64: stageBase64("ONE 🌱\r\nünïcödé 行\r\n"),
      },
    });
  });

  it("drops a conflict read that belongs to a repository the user left", async () => {
    const { controller, published } = harness();
    const git = conflictGit();
    await controller.runAction({ id: "refresh" }, git);
    const settled = published.length;
    const opening = controller.runAction(
      { id: "open-conflict", values: { path: CONFLICTED_PATH } },
      git,
    );
    // A workspace switch while the sides are being read invalidates them.
    controller.setScope({
      kind: "project",
      repositoryId: "project:synthetic-other",
      name: "Other",
    });
    await opening;

    expect(controller.model.conflictDetail).toBeNull();
    expect(controller.model.repository.repositoryId).toBe("project:synthetic-other");
    // No side of the repository that was left is ever published afterwards.
    expect(
      published
        .slice(settled)
        .every((model) => model.conflictDetail?.ours.text == null),
    ).toBe(true);
  });
});
