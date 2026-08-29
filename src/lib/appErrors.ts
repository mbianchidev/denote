import type { MarkdownErrorLocation } from "./markdownErrors";

export interface GenericAppError {
  id: number;
  kind: "generic";
  message: string;
}

export interface LinkAppError {
  id: number;
  kind: "link";
  message: string;
}

export interface MarkdownAppError {
  id: number;
  kind: "markdown";
  message: string;
  path: string;
  source: string;
  location?: MarkdownErrorLocation;
  navigationRequest: number;
}

export type AppError = GenericAppError | LinkAppError | MarkdownAppError;

export interface AppErrorsState {
  global: GenericAppError | null;
  link: LinkAppError | null;
  markdownByPath: Record<string, MarkdownAppError>;
}

export const INITIAL_APP_ERRORS: AppErrorsState = {
  global: null,
  link: null,
  markdownByPath: {},
};

export type AppErrorsAction =
  | { type: "show-global"; error: GenericAppError }
  | { type: "show-link"; error: LinkAppError }
  | { type: "show-markdown"; error: MarkdownAppError }
  | { type: "clear-markdown"; path: string }
  | { type: "clear-all" }
  | { type: "dismiss"; id: number }
  | { type: "navigate-markdown"; path: string }
  | {
      type: "rekey-markdown-prefix";
      oldPath: string;
      newPath: string;
    }
  | { type: "remove-markdown-prefix"; path: string }
  | { type: "retain-markdown-paths"; paths: string[] };

export function appErrorsReducer(
  state: AppErrorsState,
  action: AppErrorsAction,
): AppErrorsState {
  switch (action.type) {
    case "show-global":
      return { ...state, global: action.error, link: null };
    case "show-link":
      return { ...state, link: action.error };
    case "show-markdown":
      return {
        ...state,
        markdownByPath: {
          ...state.markdownByPath,
          [action.error.path]: action.error,
        },
      };
    case "clear-markdown":
      return removeMarkdownPaths(state, new Set([action.path]));
    case "clear-all":
      return INITIAL_APP_ERRORS;
    case "dismiss": {
      if (state.link?.id === action.id) {
        return { ...state, link: null };
      }
      if (state.global?.id === action.id) {
        return { ...state, global: null };
      }
      const path = Object.keys(state.markdownByPath).find(
        (candidate) => state.markdownByPath[candidate].id === action.id,
      );
      return path ? removeMarkdownPaths(state, new Set([path])) : state;
    }
    case "navigate-markdown": {
      const error = state.markdownByPath[action.path];
      if (!error?.location) {
        return state;
      }
      return {
        ...state,
        markdownByPath: {
          ...state.markdownByPath,
          [action.path]: {
            ...error,
            navigationRequest: error.navigationRequest + 1,
          },
        },
      };
    }
    case "rekey-markdown-prefix":
      return rekeyMarkdownPrefix(state, action.oldPath, action.newPath);
    case "remove-markdown-prefix":
      return removeMarkdownPrefix(state, action.path);
    case "retain-markdown-paths":
      return retainMarkdownPaths(state, new Set(action.paths));
  }
}

export function visibleAppError(
  state: AppErrorsState,
  activePath: string | null,
  activeSource: string | null,
): AppError | null {
  return (
    state.link ??
    state.global ??
    markdownAppErrorForPath(state, activePath, activeSource)
  );
}

export function markdownAppErrorForPath(
  state: AppErrorsState,
  path: string | null,
  source: string | null,
): MarkdownAppError | null {
  if (!path || source === null) {
    return null;
  }
  const error = state.markdownByPath[path];
  return error?.source === source ? error : null;
}

function rekeyMarkdownPrefix(
  state: AppErrorsState,
  oldPath: string,
  newPath: string,
): AppErrorsState {
  let changed = false;
  const markdownByPath: Record<string, MarkdownAppError> = {};
  for (const [path, error] of Object.entries(state.markdownByPath)) {
    const nextPath =
      path === oldPath || path.startsWith(`${oldPath}/`)
        ? `${newPath}${path.slice(oldPath.length)}`
        : path;
    changed ||= nextPath !== path;
    markdownByPath[nextPath] =
      nextPath === path ? error : { ...error, path: nextPath };
  }
  return changed ? { ...state, markdownByPath } : state;
}

function removeMarkdownPaths(
  state: AppErrorsState,
  paths: Set<string>,
): AppErrorsState {
  if (
    !paths.size ||
    !Object.keys(state.markdownByPath).some((path) => paths.has(path))
  ) {
    return state;
  }
  return {
    ...state,
    markdownByPath: Object.fromEntries(
      Object.entries(state.markdownByPath).filter(([path]) => !paths.has(path)),
    ),
  };
}

function removeMarkdownPrefix(
  state: AppErrorsState,
  path: string,
): AppErrorsState {
  return removeMarkdownPaths(
    state,
    new Set(
      Object.keys(state.markdownByPath).filter(
        (candidate) => candidate === path || candidate.startsWith(`${path}/`),
      ),
    ),
  );
}

function retainMarkdownPaths(
  state: AppErrorsState,
  paths: Set<string>,
): AppErrorsState {
  return removeMarkdownPaths(
    state,
    new Set(
      Object.keys(state.markdownByPath).filter((path) => !paths.has(path)),
    ),
  );
}
