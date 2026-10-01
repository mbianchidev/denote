import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, hoverTooltip, keymap } from "@codemirror/view";
import { lintGutter, nextDiagnostic, setDiagnostics } from "@codemirror/lint";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { PluginCodeFeature, PluginCodeLocation, PluginCodePosition } from "@denote/plugin-sdk";
import { PluginMarkdown } from "../components/PluginGuide";
import { CodeIntelligenceHost, codeRequestCancelled } from "../plugins/codeHost";
import { codeEditOffsets, codePositionOffset } from "./codeTools";

export interface CodeEditorBinding {
  host: CodeIntelligenceHost;
  path: string;
  projectId: string | null;
  onNavigate: (location: PluginCodeLocation) => Promise<void>;
  onResults: () => void;
  onError: (error: unknown) => void;
}

export function CodeTooltips({ host }: { host: CodeIntelligenceHost }) {
  useSyncExternalStore(host.subscribe, host.getRevision);
  return host.tooltips().map((entry) => createPortal(<PluginMarkdown markdown={entry.markdown} />, entry.element, entry.id));
}

function position(view: EditorView, offset = view.state.selection.main.head): PluginCodePosition {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

export function createCodeIntelligenceExtensions(getBinding: () => CodeEditorBinding | undefined): Extension[] {
  const initial = getBinding();
  if (!initial) return [];
  const { host, path, projectId } = initial;
  const report = (error: unknown) => { if (!codeRequestCancelled(error)) getBinding()?.onError(error); };
  const query = (view: EditorView, feature: PluginCodeFeature): boolean => {
    const binding = getBinding();
    if (!binding) return false;
    void host.query(path, feature, position(view)).then(async (result) => {
      if (!result) throw new Error("Start a language server that supports this action in Code intelligence.");
      if (result.locations?.length === 1) await binding.onNavigate(result.locations[0]);
      else binding.onResults();
    }).catch(report);
    return true;
  };
  return [
    ViewPlugin.define((view) => {
      let release: () => Promise<void> = async () => {};
      try {
        release = host.attach(path, projectId, view.state.sliceDoc(), {
          readOnly: () => view.state.facet(EditorState.readOnly),
          apply(source, edits) {
            if (view.state.facet(EditorState.readOnly)) throw new Error("Formatting is unavailable in read mode.");
            if (view.state.sliceDoc() !== source) throw new Error("The source changed before the edit could be applied.");
            view.dispatch({ changes: codeEditOffsets(source, edits), userEvent: "input.code-format" });
          },
        });
      } catch (error) { report(error); }
      let alive = true;
      let refreshing = false;
      let lastDiagnostics = "";
      const refresh = () => {
        if (!alive || refreshing) return;
        refreshing = true;
        void host.modelForDocument(path).then((model) => {
          if (!alive) return;
          const diagnostics = model.diagnostics ?? [];
          const fingerprint = JSON.stringify(diagnostics);
          if (fingerprint === lastDiagnostics) return;
          lastDiagnostics = fingerprint;
          const source = view.state.sliceDoc();
          view.dispatch(setDiagnostics(view.state, diagnostics.map((diagnostic) => ({
            from: codePositionOffset(source, diagnostic.range.start),
            to: codePositionOffset(source, diagnostic.range.end),
            severity: diagnostic.severity, message: diagnostic.message, source: diagnostic.source,
          }))));
        }).catch(report).finally(() => { refreshing = false; });
      };
      const unsubscribe = host.subscribe(refresh);
      return {
        update(update) {
          if (update.docChanged) host.update(path, update.state.sliceDoc());
          if (update.docChanged || update.selectionSet) host.setCursor(path, position(update.view));
        },
        destroy() { alive = false; unsubscribe(); void release().catch(report); },
      };
    }),
    lintGutter(),
    autocompletion({
      override: [async (context) => {
        if (context.state.readOnly) return null;
        const controller = new AbortController();
        context.addEventListener("abort", () => controller.abort(), { onDocChange: true });
        const source = context.state.sliceDoc();
        const line = context.state.doc.lineAt(context.pos);
        try {
          const result = await host.query(path, "completion", { line: line.number - 1, character: context.pos - line.from }, controller.signal);
          if (context.aborted || !result?.completions?.length) return null;
          const word = context.matchBefore(/[\p{L}\p{N}_$]+/u);
          return {
            from: word?.from ?? context.pos, filter: true,
            options: result.completions.map((item) => ({
              label: item.label, detail: item.detail,
              apply(view: EditorView) {
                if (view.state.readOnly || view.state.sliceDoc() !== source) {
                  report(new Error("The source changed; stale completion was discarded."));
                  return;
                }
                view.dispatch({ changes: codeEditOffsets(source, [item]), userEvent: "input.complete" });
              },
            })),
          };
        } catch (error) { report(error); return null; }
      }],
    }),
    hoverTooltip(async (view, offset) => {
      try {
        const result = await host.query(path, "hover", position(view, offset));
        if (!result?.hover) return null;
        return {
          pos: offset, above: true,
          create() {
            const dom = document.createElement("div");
            dom.className = "code-documentation-tooltip";
            const dispose = host.addTooltip(dom, result.hover!);
            return { dom, destroy: dispose };
          },
        };
      } catch (error) { report(error); return null; }
    }, { hideOnChange: true }),
    keymap.of([
      ...completionKeymap,
      { key: "F12", run: (view) => query(view, "definition") },
      { key: "Mod-Shift-F12", run: (view) => query(view, "references") },
      { key: "Mod-Shift-Space", run: (view) => query(view, "signature") },
      { key: "F8", run: nextDiagnostic },
      { key: "Alt-Shift-f", run(view) {
        if (view.state.readOnly) return false;
        void host.format(path).catch(report);
        return true;
      } },
    ]),
  ];
}
