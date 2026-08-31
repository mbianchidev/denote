import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { PlainTextEditor } from "./PlainTextEditor";

describe("PlainTextEditor", () => {
  it("renders line numbers and line-ending markers without changing text", () => {
    const { container } = render(
      <PlainTextEditor
        value={"first line\nsecond line"}
        ariaLabel="Edit note"
        readOnly={false}
        spellCheck
        binary={false}
        filePath="note.txt"
        lineEnding="crlf"
        displaySettings={{
          ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
          showLineNumbers: true,
          showWhitespace: true,
          showLineEndings: true,
          highlightTrailingWhitespace: false,
        }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Edit note" }),
    ).toHaveTextContent("first line");
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(container.querySelector(".cm-line-ending")).toHaveTextContent(
      "CRLF",
    );
  });

  it("reports edited source text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PlainTextEditor
        value=""
        ariaLabel="Edit source"
        readOnly={false}
        spellCheck
        binary={false}
        filePath="source.ts"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("textbox", { name: "Edit source" }));
    await user.type(
      screen.getByRole("textbox", { name: "Edit source" }),
      "hello",
    );

    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("applies externally restored content", () => {
    const props = {
      ariaLabel: "Edit restored source",
      readOnly: false,
      spellCheck: true,
      binary: false,
      filePath: "restored.js",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      onChange: vi.fn(),
    };
    const { rerender } = render(
      <PlainTextEditor {...props} value="before" />,
    );

    rerender(<PlainTextEditor {...props} value="after" />);

    expect(
      screen.getByRole("textbox", { name: "Edit restored source" }),
    ).toHaveTextContent("after");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("applies and removes a transient line-number overlay without changing text", () => {
    const props = {
      value: "const total = 3;",
      ariaLabel: "Edit project source",
      readOnly: false,
      spellCheck: false,
      binary: false,
      filePath: "code/total.ts",
      lineEnding: "lf" as const,
      onChange: vi.fn(),
    };
    const { container, rerender } = render(
      <PlainTextEditor
        {...props}
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
      />,
    );
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();

    rerender(
      <PlainTextEditor
        {...props}
        displaySettings={{
          ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
          showLineNumbers: true,
        }}
      />,
    );
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();

    rerender(
      <PlainTextEditor
        {...props}
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
      />,
    );
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Edit project source" }),
    ).toHaveTextContent("const total = 3;");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("mounts project Markdown without normalizing callout syntax", () => {
    const onChange = vi.fn();
    const value =
      "> [!WARNING]\n> Synthetic warning text.\n\n> [!NOTE]\n> Synthetic note text.";

    const { container } = render(
      <PlainTextEditor
        ariaLabel="Edit project README source"
        value={value}
        readOnly={false}
        spellCheck={false}
        binary={false}
        filePath="code/sample/README.md"
        lineEnding="lf"
        displaySettings={{
          ...DEFAULT_EDITOR_DISPLAY_SETTINGS,
          showLineNumbers: true,
        }}
        markdownSource
        onChange={onChange}
        onError={vi.fn()}
      />,
    );

    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    expect(editorElement).not.toBeNull();
    expect(EditorView.findFromDOM(editorElement!)?.state.doc.toString()).toBe(
      value,
    );
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles Mod-K as a Markdown link command in Markdown source mode", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PlainTextEditor
        ariaLabel="Edit project Markdown"
        value="Synthetic label text"
        readOnly={false}
        spellCheck={false}
        binary={false}
        filePath="code/sample/README.md"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        markdownSource
        onChange={onChange}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    view.dispatch({ selection: { anchor: 0, head: 15 } });

    expect(
      runScopeHandlers(
        view,
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
        "editor",
      ),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe("[Synthetic label]() text");
    expect(onChange).toHaveBeenLastCalledWith("[Synthetic label]() text");
  });

  it("applies, navigates to, and clears Markdown diagnostics safely", async () => {
    const props = {
      ariaLabel: "Edit broken project Markdown",
      value: "# Heading\n\nproblem",
      readOnly: false,
      spellCheck: false,
      binary: false,
      filePath: "code/sample/broken.markdown",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      markdownSource: true,
      onChange: vi.fn(),
    };
    const { container, rerender } = render(
      <PlainTextEditor
        {...props}
        errorLocation={{ line: 99, column: 99 }}
        errorNavigationRequest={0}
      />,
    );

    expect(container.querySelector(".cm-diagnostic-line")).toHaveTextContent(
      "problem",
    );
    rerender(
      <PlainTextEditor
        {...props}
        errorLocation={{ line: 99, column: 99 }}
        errorNavigationRequest={1}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    await vi.waitFor(() => expect(view.hasFocus).toBe(true));
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to);

    rerender(
      <PlainTextEditor
        {...props}
        errorLocation={undefined}
        errorNavigationRequest={1}
      />,
    );
    expect(container.querySelector(".cm-diagnostic-line")).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("does not install Markdown commands or diagnostics for ordinary source", () => {
    const { container } = render(
      <PlainTextEditor
        ariaLabel="Edit ordinary source"
        value="const sample = true;"
        readOnly={false}
        spellCheck={false}
        binary={false}
        filePath="src/sample.ts"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        errorLocation={{ line: 1, column: 1 }}
        errorNavigationRequest={1}
        onChange={vi.fn()}
      />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    expect(
      runScopeHandlers(
        view,
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
        "editor",
      ),
    ).toBe(false);
    expect(view.state.doc.toString()).toBe("const sample = true;");
    expect(container.querySelector(".cm-diagnostic-line")).toBeNull();
  });

  it("focuses and selects a requested search match", async () => {
    const { container } = render(
      <PlainTextEditor
        value="Start needle finish"
        ariaLabel="Edit searchable source"
        readOnly={false}
        spellCheck
        binary={false}
        filePath="searchable.txt"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        searchNavigation={{
          request: 1,
          from: 6,
          to: 12,
          text: "needle",
        }}
        onChange={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "Edit searchable source",
    });
    await vi.waitFor(() => expect(editor).toHaveFocus());
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    );
    expect(view?.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe("needle");
  });
});
