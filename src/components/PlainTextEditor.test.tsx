import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { syntaxTree } from "@codemirror/language";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { applyTheme } from "../lib/theme";
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

  it("reconfigures language and theme without remounting or changing source", async () => {
    const onChange = vi.fn();
    const props = {
      value: "const total = 3;",
      ariaLabel: "Edit highlighted source",
      readOnly: false,
      binary: false,
      filePath: "synthetic.ts",
      lineEnding: "crlf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      onChange,
    };
    const { container, rerender } = render(
      <PlainTextEditor {...props} spellCheck={false} />,
    );
    const editorElement =
      container.querySelector<HTMLElement>(".cm-editor")!;
    const view = EditorView.findFromDOM(editorElement)!;
    await vi.waitFor(() =>
      expect(syntaxTree(view.state).type.name).not.toBe(""),
    );
    view.dispatch({ selection: { anchor: 6, head: 11 } });
    const selection = view.state.selection.main;

    rerender(
      <PlainTextEditor
        {...props}
        spellCheck
        languageOverride="text"
      />,
    );
    applyTheme("light");

    await vi.waitFor(() => expect(syntaxTree(view.state).type.name).toBe(""));
    expect(EditorView.findFromDOM(editorElement)).toBe(view);
    expect(view.state.doc.toString()).toBe(props.value);
    expect(view.state.selection.main).toMatchObject({
      from: selection.from,
      to: selection.to,
    });
    expect(
      screen.getByRole("textbox", { name: "Edit highlighted source" }),
    ).toHaveAttribute("spellcheck", "true");
    expect(onChange).not.toHaveBeenCalled();
    applyTheme("dark");
  });

  it("widens project source and reports its live viewport", async () => {
    const onViewportChange = vi.fn();
    const { container } = render(
      <PlainTextEditor
        value={"first\nsecond\nthird"}
        ariaLabel="Edit project source"
        readOnly={false}
        spellCheck={false}
        binary={false}
        filePath="project/source.py"
        lineEnding="lf"
        displaySettings={DEFAULT_EDITOR_DISPLAY_SETTINGS}
        projectMode
        onChange={vi.fn()}
        onViewportChange={onViewportChange}
      />,
    );

    expect(container.firstElementChild).toHaveClass(
      "plain-code-editor--project",
    );
    await vi.waitFor(() =>
      expect(onViewportChange).toHaveBeenCalledWith(
        expect.objectContaining({
          firstLine: 1,
          totalLines: 3,
        }),
      ),
    );
  });

  it("reports the current viewport when an already mounted pane gains focus", async () => {
    const props = {
      value: "first\nsecond\nthird",
      ariaLabel: "Edit split source",
      readOnly: false,
      spellCheck: false,
      binary: false,
      filePath: "project/split.py",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      onChange: vi.fn(),
    };
    const { rerender } = render(<PlainTextEditor {...props} />);
    const onViewportChange = vi.fn();

    rerender(
      <PlainTextEditor
        {...props}
        onViewportChange={onViewportChange}
      />,
    );

    expect(onViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({ firstLine: 1, totalLines: 3 }),
    );
  });

  it("navigates to a source line and proportional scroll position in place", async () => {
    const props = {
      value: Array.from(
        { length: 100 },
        (_, index) => `line ${index + 1}`,
      ).join("\n"),
      ariaLabel: "Edit navigable source",
      readOnly: false,
      spellCheck: false,
      binary: false,
      filePath: "project/source.py",
      lineEnding: "lf" as const,
      displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS,
      onChange: vi.fn(),
    };
    const { container, rerender } = render(<PlainTextEditor {...props} />);
    const editorElement =
      container.querySelector<HTMLElement>(".cm-editor")!;
    const view = EditorView.findFromDOM(editorElement)!;

    rerender(
      <PlainTextEditor
        {...props}
        sourceNavigation={{ request: 1, line: 75 }}
      />,
    );
    await vi.waitFor(() =>
      expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(
        75,
      ),
    );
    expect(view.hasFocus).toBe(true);
    expect(EditorView.findFromDOM(editorElement)).toBe(view);

    Object.defineProperty(view.scrollDOM, "scrollHeight", {
      configurable: true,
      value: 1_000,
    });
    Object.defineProperty(view.scrollDOM, "clientHeight", {
      configurable: true,
      value: 200,
    });
    rerender(
      <PlainTextEditor
        {...props}
        sourceNavigation={{ request: 2, progress: 0.5 }}
      />,
    );

    expect(view.scrollDOM.scrollTop).toBe(400);
    expect(EditorView.findFromDOM(editorElement)).toBe(view);
  });
});
