import type {
  PluginSourceControlBranchChoice,
  PluginSourceControlHistoryEntry,
  PluginSourceControlRemote,
} from "@denote/plugin-sdk";
import { splitFields } from "./splitFields";

const LOCAL_PREFIX = "refs/heads/";
const REMOTE_PREFIX = "refs/remotes/";

/**
 * Parses the fixed `for-each-ref` template the host runs for `list-branches`:
 * `%(refname)`, `%(objectname)`, `%(HEAD)`, `%(upstream)`, and
 * `%(upstream:track)`, separated by tabs.
 */
export function parseBranches(
  stdout: string,
): PluginSourceControlBranchChoice[] {
  const branches: PluginSourceControlBranchChoice[] = [];
  for (const line of lines(stdout)) {
    const fields = splitFields(line, "\t", 5);
    const refname = fields[0] ?? "";
    const remote = refname.startsWith(REMOTE_PREFIX);
    const name = remote
      ? refname.slice(REMOTE_PREFIX.length)
      : refname.startsWith(LOCAL_PREFIX)
        ? refname.slice(LOCAL_PREFIX.length)
        : "";
    // The remote HEAD is a symbolic pointer, not a branch a user can choose.
    if (!name || (remote && name.endsWith("/HEAD"))) {
      continue;
    }
    const upstream = fields[3] ?? "";
    const track = trackCounts(fields[4] ?? "");
    branches.push({
      name,
      current: (fields[2] ?? "").trim() === "*",
      remote,
      upstream: upstream.startsWith(REMOTE_PREFIX)
        ? upstream.slice(REMOTE_PREFIX.length)
        : upstream || null,
      ahead: track.ahead,
      behind: track.behind,
    });
  }
  return branches;
}

/**
 * Parses `git remote --verbose`. A URL may contain spaces, so the trailing
 * `(fetch)` or `(push)` marker is matched at the end of the field instead of
 * splitting the field apart.
 */
export function parseRemotes(stdout: string): PluginSourceControlRemote[] {
  const remotes = new Map<string, PluginSourceControlRemote>();
  for (const line of lines(stdout)) {
    const fields = splitFields(line, "\t", 2);
    const name = fields[0] ?? "";
    const match = /^(.*) \((fetch|push)\)$/.exec(fields[1] ?? "");
    if (!name || !match) {
      continue;
    }
    const remote = remotes.get(name) ?? {
      name,
      fetchUrl: null,
      pushUrl: null,
    };
    if (match[2] === "fetch") {
      remote.fetchUrl = match[1] || null;
    } else {
      remote.pushUrl = match[1] || null;
    }
    remotes.set(name, remote);
  }
  return [...remotes.values()];
}

/** Number of fields the host's history template emits for each commit. */
const HISTORY_FIELDS = 7;

/**
 * Parses the fixed history template
 * `%H%x00%h%x00%an%x00%aI%x00%P%x00%D%x00%s`, which the host runs with `-z`.
 *
 * Every field is NUL separated and every record is NUL terminated, so the whole
 * report is one flat stream of fields read seven at a time. Git cannot place a
 * NUL into an author name, a subject, a ref, or a path, so no text read out of
 * the repository can shift a field or split a record. A trailing partial group,
 * such as the empty remainder after the final terminator, is discarded rather
 * than reported as a commit.
 */
export function parseHistory(
  stdout: string,
): PluginSourceControlHistoryEntry[] {
  const history: PluginSourceControlHistoryEntry[] = [];
  const fields = stdout.split("\0");
  for (
    let start = 0;
    start + HISTORY_FIELDS <= fields.length;
    start += HISTORY_FIELDS
  ) {
    const id = fields[start] ?? "";
    if (!id) {
      continue;
    }
    history.push({
      id,
      shortId: fields[start + 1] ?? id.slice(0, 7),
      authorName: fields[start + 2] ?? "",
      authoredAt: fields[start + 3] ?? "",
      summary: fields[start + 6] ?? "",
      parentIds: (fields[start + 4] ?? "").split(" ").filter(Boolean),
      refs: decorationRefs(fields[start + 5] ?? ""),
    });
  }
  return history;
}

export interface GitOperationState {
  mergeInProgress: boolean;
  cherryPickInProgress: boolean;
  revertInProgress: boolean;
  rebaseInProgress: boolean;
  sequencerInProgress: boolean;
  /**
   * Which command a paused multi-commit sequence is replaying, when the host
   * could read it. A sequence between two commits records no head file, so
   * this is the only thing that names it; anything else is null.
   */
  sequencerKind: "cherry-pick" | "revert" | null;
  bisectInProgress: boolean;
}

/**
 * Parses the host's filesystem operation-state report. A report Denote cannot
 * read is reported as unknown rather than as "nothing in progress".
 */
export function parseOperationState(stdout: string): GitOperationState | null {
  const value = parseJson(stdout);
  if (!value) {
    return null;
  }
  return {
    mergeInProgress: flag(value.mergeInProgress),
    cherryPickInProgress: flag(value.cherryPickInProgress),
    revertInProgress: flag(value.revertInProgress),
    rebaseInProgress: flag(value.rebaseInProgress),
    sequencerInProgress: flag(value.sequencerInProgress),
    sequencerKind:
      value.sequencerKind === "cherry-pick" || value.sequencerKind === "revert"
        ? value.sequencerKind
        : null,
    bisectInProgress: flag(value.bisectInProgress),
  };
}

/** Parses the host's `discover` report. Unknown output is not a repository. */
export function parseInitialized(stdout: string): boolean {
  const value = parseJson(stdout);
  return value ? value.initialized === true : false;
}

export interface GitDiscovery {
  initialized: boolean;
  /**
   * True when the host reported that this scope is a sealed, unlocked
   * encrypted vault. Unknown output is treated as unencrypted, which only ever
   * makes Denote offer less: the host refuses the operations an encrypted
   * vault cannot survive anyway.
   */
  encrypted: boolean;
}

export function parseDiscovery(stdout: string): GitDiscovery {
  const value = parseJson(stdout);
  return {
    initialized: value ? value.initialized === true : false,
    encrypted: value ? value.encrypted === true : false,
  };
}

export function describeOperationState(state: GitOperationState): string | null {
  if (state.mergeInProgress) {
    return "merge";
  }
  if (state.rebaseInProgress) {
    return "rebase";
  }
  if (state.cherryPickInProgress) {
    return "cherry-pick";
  }
  if (state.revertInProgress) {
    return "revert";
  }
  if (state.sequencerInProgress) {
    return "sequencer";
  }
  if (state.bisectInProgress) {
    return "bisect";
  }
  return null;
}

function decorationRefs(value: string): string[] {
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      const arrow = trimmed.indexOf(" -> ");
      return arrow === -1 ? trimmed : trimmed.slice(arrow + 4);
    })
    .filter(Boolean);
}

function trackCounts(value: string): { ahead: number; behind: number } {
  return {
    ahead: matchCount(value, /\bahead (\d+)\b/),
    behind: matchCount(value, /\bbehind (\d+)\b/),
  };
}

function matchCount(value: string, pattern: RegExp): number {
  const match = pattern.exec(value);
  if (!match) {
    return 0;
  }
  const count = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function flag(value: unknown): boolean {
  return value === true;
}

function lines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.length > 0);
}
