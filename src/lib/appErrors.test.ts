import { describe, expect, it } from "vitest";
import {
  appErrorsReducer,
  INITIAL_APP_ERRORS,
  visibleAppError,
  type AppErrorsState,
  type MarkdownAppError,
} from "./appErrors";

function markdownError(
  id: number,
  path: string,
  line: number,
): MarkdownAppError {
  return {
    id,
    kind: "markdown",
    path,
    source: `source:${path}:${line}`,
    message: `Line ${line}, column 1: Invalid Markdown`,
    location: { line, column: 1 },
    navigationRequest: 0,
  };
}

function visibleMarkdownError(state: AppErrorsState, path: string) {
  const source = state.markdownByPath[path]?.source ?? null;
  const error = visibleAppError(state, path, source);
  if (!error || error.kind !== "markdown") {
    throw new Error(`Expected a Markdown error for ${path}`);
  }
  return error;
}

describe("application errors", () => {
  it("keeps Markdown errors visible only for the file that produced them", () => {
    const broken = markdownError(1, "broken.md", 3);
    const state = appErrorsReducer(INITIAL_APP_ERRORS, {
      type: "show-markdown",
      error: broken,
    });

    expect(visibleAppError(state, "broken.md", broken.source)).toEqual(broken);
    expect(visibleAppError(state, "healthy.md", "healthy")).toBeNull();
    expect(visibleAppError(state, "broken.md", "fixed source")).toBeNull();
    expect(visibleAppError(state, "broken.md", broken.source)).toEqual(broken);
  });

  it("tracks and clears parser errors independently per file", () => {
    let state = appErrorsReducer(INITIAL_APP_ERRORS, {
      type: "show-markdown",
      error: markdownError(1, "one.md", 2),
    });
    state = appErrorsReducer(state, {
      type: "show-markdown",
      error: markdownError(2, "two.md", 7),
    });
    state = appErrorsReducer(state, {
      type: "clear-markdown",
      path: "one.md",
    });

    expect(visibleAppError(state, "one.md", "fixed")).toBeNull();
    expect(visibleMarkdownError(state, "two.md").location).toEqual({
      line: 7,
      column: 1,
    });
  });

  it("restores a persistent error after a transient link failure fades", () => {
    let state = appErrorsReducer(INITIAL_APP_ERRORS, {
      type: "show-global",
      error: {
        id: 1,
        kind: "generic",
        message: "Unable to save note",
      },
    });
    state = appErrorsReducer(state, {
      type: "show-markdown",
      error: markdownError(2, "broken.md", 3),
    });
    state = appErrorsReducer(state, {
      type: "show-link",
      error: {
        id: 3,
        kind: "link",
        message: "Link target not found",
      },
    });

    expect(
      visibleAppError(
        state,
        "broken.md",
        state.markdownByPath["broken.md"].source,
      )?.kind,
    ).toBe("link");

    state = appErrorsReducer(state, { type: "dismiss", id: 3 });

    expect(
      visibleAppError(
        state,
        "broken.md",
        state.markdownByPath["broken.md"].source,
      )?.kind,
    ).toBe("generic");
  });

  it("rekeys errors when files move and removes them when tabs close", () => {
    let state: AppErrorsState = appErrorsReducer(INITIAL_APP_ERRORS, {
      type: "show-markdown",
      error: markdownError(1, "docs/broken.md", 4),
    });
    state = appErrorsReducer(state, {
      type: "rekey-markdown-prefix",
      oldPath: "docs",
      newPath: "guide",
    });

    expect(visibleAppError(state, "docs/broken.md", "old")).toBeNull();
    expect(visibleMarkdownError(state, "guide/broken.md").path).toBe(
      "guide/broken.md",
    );

    state = appErrorsReducer(state, {
      type: "retain-markdown-paths",
      paths: [],
    });

    expect(visibleAppError(state, "guide/broken.md", "old")).toBeNull();
  });

  it("removes every parser error below a trashed folder", () => {
    let state = appErrorsReducer(INITIAL_APP_ERRORS, {
      type: "show-markdown",
      error: markdownError(1, "docs/one.md", 2),
    });
    state = appErrorsReducer(state, {
      type: "show-markdown",
      error: markdownError(2, "docs/nested/two.md", 4),
    });
    state = appErrorsReducer(state, {
      type: "show-markdown",
      error: markdownError(3, "other.md", 6),
    });
    state = appErrorsReducer(state, {
      type: "remove-markdown-prefix",
      path: "docs",
    });

    expect(Object.keys(state.markdownByPath)).toEqual(["other.md"]);
  });

  it("requests navigation only for the matching located error", () => {
    let state = appErrorsReducer(INITIAL_APP_ERRORS, {
      type: "show-markdown",
      error: markdownError(1, "broken.md", 3),
    });
    state = appErrorsReducer(state, {
      type: "navigate-markdown",
      path: "healthy.md",
    });
    expect(visibleMarkdownError(state, "broken.md").navigationRequest).toBe(0);

    state = appErrorsReducer(state, {
      type: "navigate-markdown",
      path: "broken.md",
    });
    expect(visibleMarkdownError(state, "broken.md").navigationRequest).toBe(1);
  });
});
