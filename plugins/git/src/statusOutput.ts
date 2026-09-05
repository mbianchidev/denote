import type {
  PluginSourceControlResource,
  PluginSourceControlResourceStatus,
} from "@denote/plugin-sdk";
import { splitFields } from "./splitFields";

export interface GitStatusReport {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: PluginSourceControlResource[];
  unstaged: PluginSourceControlResource[];
  untracked: PluginSourceControlResource[];
  conflicted: PluginSourceControlResource[];
}

const UNMODIFIED = ".";

/**
 * Parses `git status --porcelain=v2 --branch --untracked-files=all -z`.
 *
 * Records are NUL terminated, so no path is quoted or escaped, and a rename
 * record is followed by one extra NUL terminated field holding the original
 * path. Every record is split with an explicit field limit, because a path may
 * contain spaces and must stay whole in the final field.
 */
export function parseStatus(stdout: string): GitStatusReport {
  const report: GitStatusReport = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
  const records = stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length === 0) {
      continue;
    }
    const kind = record.slice(0, 2);
    if (kind === "# ") {
      readHeader(record, report);
    } else if (kind === "1 ") {
      const fields = splitFields(record, " ", 9);
      readChange(fields[1] ?? "", fields[8] ?? "", report);
    } else if (kind === "2 ") {
      const fields = splitFields(record, " ", 10);
      // The original path is its own NUL terminated field.
      index += 1;
      readChange(fields[1] ?? "", fields[9] ?? "", report);
    } else if (kind === "u ") {
      const fields = splitFields(record, " ", 11);
      const path = fields[10] ?? "";
      if (path) {
        report.conflicted.push(resource(path, "unmerged"));
      }
    } else if (kind === "? ") {
      const path = splitFields(record, " ", 2)[1] ?? "";
      if (path) {
        report.untracked.push(resource(path, "added"));
      }
    }
  }
  return report;
}

function readHeader(record: string, report: GitStatusReport): void {
  const fields = splitFields(record, " ", 3);
  const value = fields[2] ?? "";
  switch (fields[1]) {
    case "branch.head":
      if (value === "(detached)") {
        report.detached = true;
        report.branch = null;
      } else if (value) {
        report.branch = value;
      }
      return;
    case "branch.upstream":
      report.upstream = value || null;
      return;
    case "branch.ab": {
      const counts = splitFields(value, " ", 2);
      report.ahead = signedCount(counts[0] ?? "", "+");
      report.behind = signedCount(counts[1] ?? "", "-");
      return;
    }
    default:
      return;
  }
}

function readChange(
  codes: string,
  path: string,
  report: GitStatusReport,
): void {
  if (!path || codes.length < 2) {
    return;
  }
  const staged = codes[0];
  const unstaged = codes[1];
  if (staged !== UNMODIFIED) {
    report.staged.push(resource(path, resourceStatus(staged)));
  }
  if (unstaged !== UNMODIFIED) {
    report.unstaged.push(resource(path, resourceStatus(unstaged)));
  }
}

/**
 * Line counts are not part of status output, so a resource reports the change
 * kind only. Denote never invents numbers it did not read from Git.
 */
function resource(
  path: string,
  status: PluginSourceControlResourceStatus,
): PluginSourceControlResource {
  return { path, status, additions: 0, deletions: 0, binary: false };
}

function resourceStatus(code: string): PluginSourceControlResourceStatus {
  switch (code) {
    case "M":
      return "modified";
    case "T":
      return "type-changed";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

function signedCount(value: string, sign: string): number {
  if (!value.startsWith(sign)) {
    return 0;
  }
  const count = Number.parseInt(value.slice(1), 10);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
