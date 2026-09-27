import {
  PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS,
  type PluginSourceControlFileStat,
} from "@denote/plugin-sdk";
import { splitFields } from "./splitFields";

const MAX_PATH_LENGTH = 4096;

/** Parses `git diff --numstat -z`, including its extra rename path fields. */
export function parseNumstat(stdout: string): PluginSourceControlFileStat[] {
  if (stdout === "") {
    return [];
  }
  if (!stdout.endsWith("\0")) {
    throw invalidReport();
  }
  const records = stdout.split("\0");
  const files: PluginSourceControlFileStat[] = [];
  for (let index = 0; index < records.length - 1; index += 1) {
    if (files.length >= PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS) {
      throw new Error(
        `Git reported more than ${PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS} changed files. Use your own Git tooling to review the complete statistics.`,
      );
    }
    const fields = splitFields(records[index], "\t", 3);
    if (fields.length !== 3) {
      throw invalidReport();
    }
    const [added, removed] = fields;
    let path = fields[2];
    let previousPath: string | null = null;
    if (path === "") {
      previousPath = records[++index];
      path = records[++index];
      if (!validPath(previousPath)) {
        throw invalidReport();
      }
    }
    if (!validPath(path)) {
      throw invalidReport();
    }
    const binary = added === "-" && removed === "-";
    files.push({
      path,
      previousPath,
      additions: binary ? 0 : count(added),
      deletions: binary ? 0 : count(removed),
      binary,
    });
  }
  return files;
}

function validPath(path: string | undefined): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH
  );
}

function count(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw invalidReport();
  }
  return parsed;
}

function invalidReport(): Error {
  return new Error(
    "Git returned an incomplete or invalid file-change report. Refresh to try again.",
  );
}
