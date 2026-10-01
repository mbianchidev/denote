import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import type { PluginCodeRequest, PluginCodeResult } from "@denote/plugin-sdk";
import { PlainTextEditor } from "../components/PlainTextEditor";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "./editorDisplay";
import { CodeIntelligenceHost } from "../plugins/codeHost";

vi.mock("./api", () => ({
  api: { codeToolEnvironment: vi.fn(async () => ({
    scope: { projectId: "project-example", rootPath: "sample" }, language: "rust",
    lsp: {}, dap: {},
  })) },
  errorMessage: (error: unknown) => String(error),
}));

describe("source editor code intelligence", () => {
  it("attaches without starting tools and navigates F12 results at exact UTF-16 positions", async () => {
    const host = new CodeIntelligenceHost();
    const execute = vi.fn(async (_plugin: string, _id: string, request: PluginCodeRequest): Promise<PluginCodeResult> => ({
      status: "Ready", capabilities: ["definition"],
      ...(request.operation === "definition" ? { locations: [{
        path: "sample/other.rs", range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
      }] } : {}),
    }));
    host.configure({
      pluginId: "denote.synthetic", id: "denote.synthetic.code", title: "Code",
      languages: [{ id: "rust", title: "Rust", server: "Synthetic", debugger: "Synthetic", setup: "Choose a tool." }],
    }, execute, "/synthetic/vault", "project-example", false);
    const onNavigate = vi.fn(async () => {});
    const onChange = vi.fn();
    render(<PlainTextEditor
      value="fn main() {}" ariaLabel="Edit synthetic source"
      readOnly={false} spellCheck={false} binary={false} filePath="sample/main.rs"
      lineEnding="lf" displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} onChange={onChange}
      code={{ host, path: "sample/main.rs", projectId: "project-example", onNavigate, onResults: vi.fn(), onError: vi.fn() }}
    />);
    await waitFor(() => expect(host.document("sample/main.rs")).not.toBeNull());
    expect(execute).not.toHaveBeenCalled();
    await act(async () => { await host.run("rust", "project-example", "sample/main.rs", "start"); });
    const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Edit synthetic source" }))!;
    view.dispatch({ selection: { anchor: 4 } });
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "F12" }), "editor")).toBe(true);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      path: "sample/other.rs", range: expect.objectContaining({ start: { line: 1, character: 2 } }),
    })));
    expect(onChange).not.toHaveBeenCalled();
    host.dispose();
  });

  it("restores the exact requested column without editing source", () => {
    const onChange = vi.fn();
    render(<PlainTextEditor
      value={"first\nsecond"} ariaLabel="Read synthetic source"
      readOnly spellCheck={false} binary={false} filePath="sample/main.rs"
      lineEnding="lf" displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS} onChange={onChange}
      sourceNavigation={{ request: 1, line: 2, column: 4 }}
    />);
    const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Read synthetic source" }))!;
    expect(view.state.selection.main.head).toBe(9);
    expect(onChange).not.toHaveBeenCalled();
  });
});
