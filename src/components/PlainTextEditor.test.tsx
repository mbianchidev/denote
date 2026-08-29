import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});
