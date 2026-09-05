/**
 * Reads the host's `list-conflicts` report.
 *
 * The host runs `git ls-files --unmerged -z`, which writes one record per
 * recorded stage as `<mode> <object> <stage>\t<path>`, NUL terminated. Git
 * cannot put a NUL or a tab into either field, so the path is always the exact
 * repository-relative path, and a record Denote cannot read is dropped rather
 * than guessed at.
 */
export interface GitUnmergedPath {
  path: string;
  /** Whether Git holds the common ancestor of this path. */
  base: boolean;
  /** Whether Git holds the current branch's side. */
  ours: boolean;
  /** Whether Git holds the incoming side. */
  theirs: boolean;
}

export function parseUnmergedPaths(stdout: string): GitUnmergedPath[] {
  const entries = new Map<string, GitUnmergedPath>();
  for (const record of stdout.split("\0")) {
    if (record.length === 0) {
      continue;
    }
    const separator = record.indexOf("\t");
    if (separator === -1) {
      continue;
    }
    const path = record.slice(separator + 1);
    const stage = record.slice(0, separator).trim().split(/\s+/).pop() ?? "";
    if (!path || !["1", "2", "3"].includes(stage)) {
      continue;
    }
    const entry = entries.get(path) ?? {
      path,
      base: false,
      ours: false,
      theirs: false,
    };
    if (stage === "1") {
      entry.base = true;
    } else if (stage === "2") {
      entry.ours = true;
    } else {
      entry.theirs = true;
    }
    entries.set(path, entry);
  }
  return [...entries.values()];
}
