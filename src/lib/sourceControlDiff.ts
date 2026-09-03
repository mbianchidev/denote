import type {
  PluginSourceControlDiffFile,
  PluginSourceControlDiffSource,
} from "@denote/plugin-sdk";

export function sourceControlPatch(
  files: PluginSourceControlDiffFile[],
): string {
  return files.map(sourceControlFilePatch).join("");
}

export function sourceControlFilePatch(
  file: PluginSourceControlDiffFile,
): string {
  const lines: string[] = [];
  const oldPath = file.previousPath ?? file.path;
  const oldHeader =
    file.status === "added" ? "/dev/null" : `a/${diffPath(oldPath)}`;
  const newHeader =
    file.status === "deleted" ? "/dev/null" : `b/${diffPath(file.path)}`;
  lines.push(
    `diff --git a/${diffPath(oldPath)} b/${diffPath(file.path)}`,
    `--- ${oldHeader}`,
    `+++ ${newHeader}`,
  );
  if (file.binary) {
    lines.push(`Binary files ${oldHeader} and ${newHeader} differ`);
  } else {
    for (const hunk of file.hunks) {
      lines.push(hunk.header);
      for (const line of hunk.lines) {
        const marker =
          line.kind === "addition"
            ? "+"
            : line.kind === "deletion"
              ? "-"
              : " ";
        lines.push(`${marker}${line.content}`);
        if (line.noNewlineAtEndOfFile) {
          lines.push("\\ No newline at end of file");
        }
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function sourceControlDiffTitle(
  path: string,
  source: PluginSourceControlDiffSource["kind"],
): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "changes";
  const base = fileName.replace(/\.[^.]+$/, "") || "changes";
  const suffix =
    source === "index" ? ".staged" : source === "commit" ? ".commit" : "";
  return `${base}${suffix}.diff`;
}

export function sourceControlDiffPath(
  repositoryId: string,
  title: string,
  source: PluginSourceControlDiffSource,
): string {
  const identity =
    source.kind === "commit" ? `${source.kind}:${source.commitId}` : source.kind;
  return `denote-diff:${repositoryId}:${identity}:${title}`;
}

function diffPath(path: string): string {
  return path.replace(/\\/g, "/");
}
