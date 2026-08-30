import { indentUnit } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "./editorDisplay";
import {
  createEditorDisplayExtensions,
  createEditorDiagnosticExtensions,
  createEditorTabExtensions,
  denoteCodeMirrorTheme,
  insertMarkdownLink,
  setEditorDiagnostic,
} from "./editorExtensions";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";

describe("editor display extensions", () => {
  it("installs only enabled visual guides", () => {
    expect(
      createEditorDisplayExtensions(DEFAULT_EDITOR_DISPLAY_SETTINGS, "lf"),
    ).toHaveLength(3);
    expect(
      createEditorDisplayExtensions(
        {
          ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
          showLineNumbers: true,
          showWhitespace: true,
          showLineEndings: true,
          highlightTrailingWhitespace: true,
        },
        "crlf",
      ),
    ).toHaveLength(7);
  });

  it("provides a shared semantic theme for every CodeMirror surface", () => {
    expect(denoteCodeMirrorTheme).toHaveLength(2);
  });

  it("wraps selected source text as a Markdown link without a dialog", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "Selected text",
        selection: { anchor: 0, head: 8 },
      }),
    });

    expect(insertMarkdownLink(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("[Selected]() text");
    expect(view.state.selection.main.from).toBe(11);
    view.destroy();
  });

  it("escapes brackets inside selected source link text", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "a[b]c",
        selection: { anchor: 0, head: 5 },
      }),
    });

    expect(insertMarkdownLink(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("[a\\[b\\]c]()");
    view.destroy();
  });

  it("creates an empty source link with the cursor ready for its label", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "Text" }),
    });

    expect(insertMarkdownLink(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("[]()Text");
    expect(view.state.selection.main.from).toBe(1);
    view.destroy();
  });

  it("does not edit read-only source documents", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "Text",
        extensions: [EditorState.readOnly.of(true)],
      }),
    });

    expect(insertMarkdownLink(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("Text");
    view.destroy();
  });

  it("uses the selected indentation width when Tab is pressed", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "line",
        extensions: [
          createEditorTabExtensions({
            ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
            tabSize: 2,
          }),
        ],
      }),
    });

    expect(view.state.tabSize).toBe(2);
    expect(view.state.facet(indentUnit)).toBe("  ");
    expect(
      runScopeHandlers(
        view,
        new KeyboardEvent("keydown", { key: "Tab" }),
        "editor",
      ),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe("  line");
    view.destroy();
  });

  it("highlights a Markdown parser line and character", () => {
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "first\nsecond",
        extensions: createEditorDiagnosticExtensions(),
      }),
    });
    view.dispatch({
      effects: setEditorDiagnostic.of({ line: 2, column: 2 }),
    });

    expect(view.dom.querySelector(".cm-diagnostic-line")).toHaveTextContent(
      "second",
    );
    expect(
      view.dom.querySelector(".cm-diagnostic-character"),
    ).toHaveTextContent("e");
    view.destroy();
  });
});
