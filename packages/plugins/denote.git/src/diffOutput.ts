import type {
  PluginGitHunk,
  PluginGitHunkLine,
  PluginSourceControlDiffFile,
  PluginSourceControlDiffHunk,
  PluginSourceControlDiffLine,
} from "@denote/plugin-sdk";

/** Bounds for one parsed diff. A larger one is refused, never truncated. */
export const MAX_DIFF_FILES = 20;
export const MAX_DIFF_HUNKS = 200;
export const MAX_DIFF_LINES = 20000;
export const MAX_DIFF_LINE_LENGTH = 8192;

/**
 * Raised when a diff is larger than Denote will parse. It is reported rather
 * than silently cut, because a truncated diff would let a surface offer a hunk
 * action for a hunk it never actually read.
 */
export class DiffTooLarge extends Error {
  constructor() {
    super(
      "This diff is larger than Denote can display. Use your own Git tooling to review it.",
    );
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const RENAME_ORIGIN = "rename from";
const COPY_ORIGIN = "copy from";
const RENAME_TARGET = "rename to";
const COPY_TARGET = "copy to";

/**
 * Parses the unified diff the host produces for `diff` and `show`.
 *
 * Only structure Git itself emits is read: the `diff --git` header, the two
 * file headers, similarity and mode metadata, hunk headers, and the three line
 * prefixes. Anything else is ignored rather than guessed at, and a file whose
 * content Git refused to show is reported as binary with no hunks.
 */
export function parseUnifiedDiff(stdout: string): PluginSourceControlDiffFile[] {
  const files: PluginSourceControlDiffFile[] = [];
  let file: PluginSourceControlDiffFile | null = null;
  let hunk: PluginSourceControlDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let totalLines = 0;
  const lines = stdout.split("\n");
  if (lines.length > MAX_DIFF_LINES) {
    throw new DiffTooLarge();
  }
  const startFile = (
    path: string,
    previousPath: string | null,
  ): PluginSourceControlDiffFile => {
    if (files.length >= MAX_DIFF_FILES) {
      throw new DiffTooLarge();
    }
    const started: PluginSourceControlDiffFile = {
      path,
      previousPath,
      status: "modified",
      additions: 0,
      deletions: 0,
      binary: false,
      hunks: [],
    };
    files.push(started);
    return started;
  };
  let oldName: string | null = null;
  // What is left of the open hunk header's two counts. Git states exactly how
  // many lines each side of a hunk carries, so the counts, rather than the
  // shape of a line, are what say where the body ends.
  let remainingOld = 0;
  let remainingNew = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // The header is only a starting guess. Git writes both names on one line
      // with no reliable separator, so the authoritative names are read from
      // the tab-terminated `---` and `+++` lines below. A binary file has
      // neither, which is why the guess is kept at all.
      file = startFile(
        headerPaths(line.slice("diff --git ".length))?.to ?? "",
        null,
      );
      hunk = null;
      remainingOld = 0;
      remainingNew = 0;
      oldName = null;
      continue;
    }
    if (!file) {
      continue;
    }
    if (hunk) {
      // The body of an open hunk is classified before any header prefix is
      // tested, because Git writes the file's own bytes straight after the
      // marker: a deleted `-- ` separator reads as `--- `, and an added
      // `++ other.md` reads as `+++ other.md`. Reading the headers first would
      // take either one for the start of another file and abandon the hunk
      // mid-body, which loses its remaining lines and its line numbers.
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" annotates the line before it, and
        // counts towards neither side of the hunk.
        const previous = hunk.lines[hunk.lines.length - 1];
        if (previous) {
          previous.noNewlineAtEndOfFile = true;
        }
        continue;
      }
      const marker = line.charAt(0);
      if (
        (remainingOld > 0 || remainingNew > 0) &&
        (marker === " " || marker === "+" || marker === "-")
      ) {
        const content = line.slice(1);
        if (content.length > MAX_DIFF_LINE_LENGTH) {
          throw new DiffTooLarge();
        }
        totalLines += 1;
        if (totalLines > MAX_DIFF_LINES) {
          throw new DiffTooLarge();
        }
        if (marker === "+") {
          hunk.lines.push(diffLine("addition", null, newLine, content));
          newLine += 1;
          remainingNew -= 1;
          file.additions += 1;
        } else if (marker === "-") {
          hunk.lines.push(diffLine("deletion", oldLine, null, content));
          oldLine += 1;
          remainingOld -= 1;
          file.deletions += 1;
        } else {
          hunk.lines.push(diffLine("context", oldLine, newLine, content));
          oldLine += 1;
          newLine += 1;
          remainingOld -= 1;
          remainingNew -= 1;
        }
        continue;
      }
      // Both counts are spent, or Git wrote something no body line can be, so
      // this line belongs to the report again rather than to the hunk.
      hunk = null;
      remainingOld = 0;
      remainingNew = 0;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      file.binary = true;
      file.hunks = [];
      hunk = null;
      continue;
    }
    if (line.startsWith("similarity index ")) {
      continue;
    }
    const origin = originHeader(line);
    if (origin) {
      file.previousPath = origin.previousPath;
      file.status = origin.status;
      continue;
    }
    const target = targetHeader(line);
    if (target) {
      // A rename or a copy that changed nothing has no `---` or `+++` line, so
      // this is the only place its new name is written unambiguously.
      file.path = target;
      continue;
    }
    if (line.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (line.startsWith("--- ")) {
      const previous = fileHeaderName(line.slice(4));
      if (previous === null) {
        file.status = "added";
      } else {
        oldName = previous;
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const next = fileHeaderName(line.slice(4));
      if (next === null) {
        file.status = "deleted";
        if (oldName !== null) {
          file.path = oldName;
        }
      } else {
        file.path = next;
      }
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      if (file.hunks.length >= MAX_DIFF_HUNKS) {
        throw new DiffTooLarge();
      }
      const oldStart = Number.parseInt(header[1], 10);
      const oldLines = header[2] === undefined ? 1 : Number.parseInt(header[2], 10);
      const newStart = Number.parseInt(header[3], 10);
      const newLines = header[4] === undefined ? 1 : Number.parseInt(header[4], 10);
      hunk = {
        header: line,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      };
      oldLine = oldStart;
      newLine = newStart;
      remainingOld = oldLines;
      remainingNew = newLines;
      file.hunks.push(hunk);
      continue;
    }
  }
  return named(files);
}

/**
 * Reports whether Denote may offer a hunk action for one parsed file.
 *
 * Only an ordinary modification of a tracked text file can be staged by hunk:
 * the host reconstructs a patch whose two sides both name that one path, which
 * is not what a rename, a copy, an addition, a deletion, or a mode change
 * looks like, and binary content has no lines to choose between.
 */
export function supportsHunkStaging(
  file: PluginSourceControlDiffFile,
): boolean {
  return (
    !file.binary && file.status === "modified" && file.previousPath === null
  );
}

function diffLine(
  kind: PluginSourceControlDiffLine["kind"],
  oldLineNumber: number | null,
  newLineNumber: number | null,
  content: string,
): PluginSourceControlDiffLine {
  return { kind, oldLineNumber, newLineNumber, content };
}

/**
 * Reads the name Git writes on a `---` or `+++` line, or null for
 * `/dev/null`.
 *
 * Git terminates the name with a tab whenever it could otherwise be cut short,
 * and quotes it when it holds a byte that needs escaping, so both are undone
 * here. This is the authoritative name: unlike the `diff --git` line, it
 * carries exactly one path.
 */
function fileHeaderName(value: string): string | null {
  const tab = value.indexOf("\t");
  const name = (tab === -1 ? value : value.slice(0, tab)).trimEnd();
  if (name === "/dev/null") {
    return null;
  }
  return stripPrefix(name);
}

/**
 * Reads the `a/<path> b/<path>` pair Git writes on the `diff --git` line.
 *
 * Git writes both names on one line with no delimiter of its own, so a name
 * that contains a space makes the line genuinely ambiguous. A quoted pair is
 * read from the quotes outwards. An unquoted pair is resolved by finding the
 * split at which both halves name the same path, which is what every change
 * except a rename or a copy looks like; anything else falls back to the last
 * `" b/"` and is corrected by the `---` and `+++` lines that follow.
 */
function headerPaths(value: string): { from: string; to: string } | null {
  if (value.startsWith('"')) {
    const end = closingQuote(value);
    if (end === -1 || value.charAt(end + 1) !== " ") {
      return null;
    }
    return {
      from: stripPrefix(unquote(value.slice(0, end + 1))),
      to: stripPrefix(unquote(value.slice(end + 2))),
    };
  }
  for (let index = value.indexOf(" "); index !== -1; index = value.indexOf(" ", index + 1)) {
    const from = value.slice(0, index);
    const to = value.slice(index + 1);
    if (
      from.startsWith("a/") &&
      to.startsWith("b/") &&
      from.slice(2) === to.slice(2)
    ) {
      return { from: from.slice(2), to: to.slice(2) };
    }
  }
  // A rename that needed quoting on only one side still has an unambiguous
  // boundary: the quote that opens the second name.
  const quoted = value.indexOf(' "');
  if (quoted !== -1) {
    return {
      from: stripPrefix(value.slice(0, quoted)),
      to: stripPrefix(value.slice(quoted + 1)),
    };
  }
  const separator = value.lastIndexOf(" b/");
  if (separator === -1) {
    return null;
  }
  return {
    from: stripPrefix(value.slice(0, separator)),
    to: stripPrefix(value.slice(separator + 1)),
  };
}

/** Index of the closing quote of a C-quoted name, honouring backslashes. */
function closingQuote(value: string): number {
  for (let index = 1; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === '"') {
      return index;
    }
  }
  return -1;
}

/**
 * Reads the `rename from` and `copy from` headers, which name the path the
 * change started at.
 */
function originHeader(
  line: string,
): { previousPath: string; status: "renamed" | "copied" } | null {
  for (const [prefix, status] of [
    [RENAME_ORIGIN, "renamed"],
    [COPY_ORIGIN, "copied"],
  ] as const) {
    if (line.startsWith(`${prefix} `)) {
      return {
        previousPath: stripPrefix(line.slice(prefix.length + 1)),
        status,
      };
    }
  }
  return null;
}

const ESCAPES: Record<string, string> = {
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * Decodes the C-quoted name Git writes when `core.quotePath` is on.
 *
 * Every byte outside printable ASCII is written as a three-digit octal escape,
 * so the escapes are collected as bytes and decoded as UTF-8 together: decoding
 * them one at a time would turn each byte of a multi-byte character into its
 * own replacement character.
 */
/** Reads the `rename to` and `copy to` headers, which name the new path. */
function targetHeader(line: string): string | null {
  for (const prefix of [RENAME_TARGET, COPY_TARGET]) {
    if (line.startsWith(`${prefix} `)) {
      return stripPrefix(line.slice(prefix.length + 1));
    }
  }
  return null;
}

function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) {
    return value;
  }
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charAt(index);
    if (character !== "\\") {
      for (const byte of encoder.encode(character)) {
        bytes.push(byte);
      }
      continue;
    }
    const next = body.charAt(index + 1);
    if (next >= "0" && next <= "7") {
      const octal = body.slice(index + 1, index + 4);
      const byte = Number.parseInt(octal, 8);
      if (octal.length === 3 && Number.isSafeInteger(byte) && byte <= 0xff) {
        bytes.push(byte);
        index += 3;
        continue;
      }
    }
    const escaped = ESCAPES[next];
    for (const byte of encoder.encode(escaped ?? next)) {
      bytes.push(byte);
    }
    index += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripPrefix(value: string): string {
  const trimmed = unquote(value.trim());
  return trimmed.startsWith("a/") || trimmed.startsWith("b/")
    ? trimmed.slice(2)
    : trimmed;
}

/** Drops entries Git named in a way this parser could not resolve. */
function named(
  files: PluginSourceControlDiffFile[],
): PluginSourceControlDiffFile[] {
  return files.filter((file) => file.path.length > 0);
}

/**
 * Rebuilds the typed request payload for one parsed hunk.
 *
 * Only the structure Denote parsed is sent: line kinds, their text, the
 * missing-newline annotation, and the exact line range. No patch text crosses
 * the boundary, so the host builds the patch from these fields alone.
 */
export function hunkRequest(hunk: PluginSourceControlDiffHunk): PluginGitHunk {
  return {
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines.map((line) => {
      const entry: PluginGitHunkLine = {
        kind:
          line.kind === "addition"
            ? "addition"
            : line.kind === "deletion"
              ? "deletion"
              : "context",
        content: line.content,
      };
      return line.noNewlineAtEndOfFile
        ? { ...entry, noNewlineAtEndOfFile: true }
        : entry;
    }),
  };
}
