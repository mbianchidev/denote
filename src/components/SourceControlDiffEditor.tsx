import { PatchDiff } from "@pierre/diffs/react";
import { FileText, Minus, Plus } from "lucide-react";
import { Component, useMemo, type ReactNode } from "react";
import type { PluginSourceControlAction } from "@denote/plugin-sdk";
import type { Theme } from "../lib/theme";
import { sourceControlFilePatch } from "../lib/sourceControlDiff";
import type { EditorTab } from "../types";

interface SourceControlDiffEditorProps {
  tab: EditorTab;
  theme: Theme;
  actionsAvailable: boolean;
  onAction: (action: PluginSourceControlAction) => void;
  onOpenFile: (path: string) => void;
}

export function SourceControlDiffEditor({
  tab,
  theme,
  actionsAvailable,
  onAction,
  onOpenFile,
}: SourceControlDiffEditorProps) {
  const detail = tab.sourceControlDiff;
  const options = useMemo(
    () => ({
      themeType: theme,
      diffStyle: "unified" as const,
      diffIndicators: "bars" as const,
      overflow: "scroll" as const,
      hunkSeparators: "line-info" as const,
      stickyHeader: true,
    }),
    [theme],
  );
  if (!detail) {
    return null;
  }
  const staged = detail.source.kind === "index";
  const actionable =
    actionsAvailable &&
    (detail.source.kind === "index" || detail.source.kind === "worktree");

  return (
    <section
      className="source-control-diff-editor"
      aria-label={`Diff ${tab.title}`}
    >
      <header className="source-control-diff-editor__header">
        <div>
          <strong>{tab.title}</strong>
          <span>Temporary .diff · read-only</span>
        </div>
        <span>{detail.repositoryLabel}</span>
      </header>
      <div className="source-control-diff-editor__actions">
        {detail.files.map((file) => (
          <section key={file.path} aria-label={`Actions for ${file.path}`}>
            <div>
              <strong>{file.path}</strong>
              {file.status !== "deleted" ? (
                <button
                  type="button"
                  aria-label={`Open file ${file.path}`}
                  title={`Open file ${file.path}`}
                  onClick={() => onOpenFile(file.path)}
                >
                  <FileText aria-hidden="true" size={14} />
                </button>
              ) : null}
              {actionable ? (
                <button
                  type="button"
                  aria-label={`${staged ? "Unstage" : "Stage"} ${file.path}`}
                  title={`${staged ? "Unstage" : "Stage"} ${file.path}`}
                  onClick={() =>
                    onAction({
                      id: staged ? "unstage" : "stage",
                      values: { path: file.path },
                    })
                  }
                >
                  {staged ? (
                    <Minus aria-hidden="true" size={14} />
                  ) : (
                    <Plus aria-hidden="true" size={14} />
                  )}
                </button>
              ) : null}
            </div>
            {actionable && supportsHunks(file)
              ? file.hunks.map((hunk, index) => (
                  <button
                    type="button"
                    key={`${hunk.header}:${index}`}
                    aria-label={`${staged ? "Unstage" : "Stage"} hunk ${hunk.header} in ${file.path}`}
                    title={`${staged ? "Unstage" : "Stage"} hunk ${hunk.header} in ${file.path}`}
                    onClick={() =>
                      onAction({
                        id: staged ? "unstage-hunk" : "stage-hunk",
                        values: { path: file.path, hunk: index },
                      })
                    }
                  >
                    {staged ? (
                      <Minus aria-hidden="true" size={14} />
                    ) : (
                      <Plus aria-hidden="true" size={14} />
                    )}
                    <span>{hunk.header}</span>
                  </button>
                ))
              : null}
          </section>
        ))}
      </div>
      <div className="source-control-diff-editor__patch">
        {detail.files.map((file) => {
          const patch = sourceControlFilePatch(file);
          return (
            <DiffRenderBoundary
              key={`${file.previousPath ?? ""}:${file.path}`}
              patch={patch}
            >
              <PatchDiff
                patch={patch}
                options={options}
                disableWorkerPool
              />
            </DiffRenderBoundary>
          );
        })}
      </div>
    </section>
  );
}

class DiffRenderBoundary extends Component<
  { patch: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Unable to render the structured diff with Pierre Diffs:", error);
  }

  render() {
    return this.state.failed ? (
      <pre
        className="source-control-diff-editor__fallback"
        aria-label="Plain diff fallback"
      >
        {this.props.patch}
      </pre>
    ) : (
      this.props.children
    );
  }
}

function supportsHunks(
  file: NonNullable<EditorTab["sourceControlDiff"]>["files"][number],
): boolean {
  return (
    !file.binary && file.status === "modified" && file.previousPath === null
  );
}
