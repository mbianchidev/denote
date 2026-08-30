import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { describe, expect, it } from "vitest";
import {
  hasIncompleteStandardMarkdownAngle,
  restoreStandardMarkdownAngles,
} from "./mdxCompatibility";

function parse(markdown: string) {
  return fromMarkdown(markdown);
}

describe("MDX standard Markdown compatibility", () => {
  it("treats comparisons and placeholder spans as text", () => {
    const source =
      "Mock threshold <42 units\n\nMarker <7\n\nToken <mock-key or example sample.invalid>";
    expect(parse(source).children).toHaveLength(3);
  });

  it("treats HTML and JSX-looking spans as standard Markdown text", () => {
    expect(parse("Press <kbd>Ctrl</kbd>.").children).toHaveLength(1);
  });

  it("handles angle text at block and list-item starts", () => {
    expect(() =>
      parse("<mock-key>\n\n- <7\n\ncontinued"),
    ).not.toThrow();
  });

  it("detects only unfinished angle tokens outside code", () => {
    expect(hasIncompleteStandardMarkdownAngle("Type <a")).toBe(true);
    expect(hasIncompleteStandardMarkdownAngle("Type <a>")).toBe(false);
    expect(hasIncompleteStandardMarkdownAngle("`Type <a`")).toBe(false);
  });

  it("preserves formatting and soft continuations on angle-leading lines", () => {
    const source = "<mock-key> **bold**\ncontinuation";
    expect(
      restoreStandardMarkdownAngles(
        toMarkdown(parse(source)).trimEnd(),
        source,
      ),
    ).toBe(source);
  });

  it("leaves indented angle text as code blocks", () => {
    expect(parse("    <mock-key>").children[0]?.type).toBe("code");
    const list = parse("- item\n\n      <mock-key>").children[0];
    expect(JSON.stringify(list)).toContain('"type":"code"');
  });

  it("restores serializer escapes without changing literal angle text", () => {
    expect(
      restoreStandardMarkdownAngles(
        "Mock threshold \\<42 units\n\nToken \\<mock-key>",
        "Mock threshold <42 units\n\nToken <mock-key>",
      ),
    ).toBe("Mock threshold <42 units\n\nToken <mock-key>");
    expect(
      restoreStandardMarkdownAngles("New value: \\<42", "Before"),
    ).toBe("New value: <42");
    expect(
      restoreStandardMarkdownAngles("New slash: \\\\<42", "Before"),
    ).toBe("New slash: \\\\<42");
    expect(
      restoreStandardMarkdownAngles(
        String.raw`Use \\\<mock-key>`,
        "Use <mock-key>",
      ),
    ).toBe(String.raw`Use \\<mock-key>`);
  });
});
